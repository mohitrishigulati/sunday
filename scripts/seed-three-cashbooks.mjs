import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || key === "your-service-role-key") {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function fail(message, extra) {
  console.error(message, extra ?? "");
  process.exit(1);
}

async function ensureLocation(companyId, code, name, cashGroupId) {
  const { data: existing } = await supabase
    .from("locations")
    .select("id, cash_ledger_id")
    .eq("company_id", companyId)
    .eq("code", code)
    .maybeSingle();
  if (existing?.id && existing.cash_ledger_id) return existing.id;

  const ledgerCode = `CASH-${code}`;
  let { data: cashLedger } = await supabase
    .from("ledgers")
    .select("id")
    .eq("company_id", companyId)
    .eq("code", ledgerCode)
    .maybeSingle();
  if (!cashLedger) {
    const created = await supabase
      .from("ledgers")
      .insert({
        company_id: companyId,
        account_group_id: cashGroupId,
        code: ledgerCode,
        name: `${name} Cash`,
        ledger_type: "cash",
        is_intercompany: false,
      })
      .select("id")
      .single();
    if (created.error || !created.data) fail("Cash ledger failed", created.error);
    cashLedger = created.data;
  }

  if (existing?.id) {
    const updated = await supabase
      .from("locations")
      .update({ is_cash_location: true, cash_ledger_id: cashLedger.id, location_type: "cash_counter" })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (updated.error) fail("Location update failed", updated.error);
    return updated.data.id;
  }

  const createdLoc = await supabase
    .from("locations")
    .insert({
      company_id: companyId,
      code,
      name,
      location_type: "cash_counter",
      is_cash_location: true,
      cash_ledger_id: cashLedger.id,
    })
    .select("id")
    .single();
  if (createdLoc.error || !createdLoc.data) fail("Location insert failed", createdLoc.error);
  return createdLoc.data.id;
}

async function ensureExpenseLedger(companyId, code, name, groupId) {
  const { data: existing } = await supabase
    .from("ledgers")
    .select("id")
    .eq("company_id", companyId)
    .eq("code", code)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const created = await supabase
    .from("ledgers")
    .insert({
      company_id: companyId,
      account_group_id: groupId,
      code,
      name,
      ledger_type: "general",
      is_intercompany: false,
    })
    .select("id")
    .single();
  if (created.error || !created.data) fail(`Expense ledger ${code} failed`, created.error);
  return created.data.id;
}

async function ensurePartyLedger(companyId, party, sundryGroupId) {
  const { data: link } = await supabase
    .from("party_company_links")
    .select("ledger_id")
    .eq("party_id", party.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (link?.ledger_id) return link.ledger_id;

  const { data: existing } = await supabase
    .from("ledgers")
    .select("id")
    .eq("company_id", companyId)
    .eq("party_id", party.id)
    .is("deleted_at", null)
    .limit(1);
  if (existing?.[0]?.id) {
    await supabase.from("party_company_links").upsert(
      { party_id: party.id, company_id: companyId, ledger_id: existing[0].id },
      { onConflict: "party_id,company_id" },
    );
    return existing[0].id;
  }

  const codes = [party.code.toUpperCase(), `${party.code.toUpperCase()}-P`];
  for (const code of codes) {
    const created = await supabase
      .from("ledgers")
      .insert({
        company_id: companyId,
        account_group_id: sundryGroupId,
        code,
        name: party.name,
        ledger_type: "party",
        party_id: party.id,
        is_intercompany: false,
      })
      .select("id")
      .single();
    if (!created.error && created.data) {
      await supabase.from("party_company_links").upsert(
        { party_id: party.id, company_id: companyId, ledger_id: created.data.id },
        { onConflict: "party_id,company_id" },
      );
      return created.data.id;
    }
  }
  fail(`Party ledger failed for ${party.code}`);
}

async function insertCashVoucher({
  companyId,
  locationId,
  financialYearId,
  voucherTypeId,
  cashLedgerId,
  counterpartyLedgerId,
  partyId,
  voucherDate,
  amount,
  narration,
  kind,
  createdBy,
}) {
  const draftRef = `DRAFT-${crypto.randomUUID().slice(0, 8)}`;
  const voucher = await supabase
    .from("vouchers")
    .insert({
      company_id: companyId,
      location_id: locationId,
      financial_year_id: financialYearId,
      voucher_type_id: voucherTypeId,
      voucher_date: voucherDate,
      draft_ref: draftRef,
      narration,
      party_id: partyId,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (voucher.error || !voucher.data) fail("Voucher insert failed", voucher.error);

  const cashIsDebit = kind === "receipt";
  const lines = await supabase.from("voucher_lines").insert([
    {
      voucher_id: voucher.data.id,
      line_no: 1,
      company_id: companyId,
      location_id: locationId,
      financial_year_id: financialYearId,
      ledger_id: cashLedgerId,
      debit_amount: cashIsDebit ? amount : 0,
      credit_amount: cashIsDebit ? 0 : amount,
      narration,
    },
    {
      voucher_id: voucher.data.id,
      line_no: 2,
      company_id: companyId,
      location_id: locationId,
      financial_year_id: financialYearId,
      ledger_id: counterpartyLedgerId,
      party_id: partyId,
      debit_amount: cashIsDebit ? 0 : amount,
      credit_amount: cashIsDebit ? amount : 0,
      narration,
    },
  ]);
  if (lines.error) {
    await supabase.from("vouchers").delete().eq("id", voucher.data.id);
    fail("Voucher lines failed", lines.error);
  }
  return voucher.data.id;
}

const { data: companies, error: companyError } = await supabase.from("companies").select("id, code, name").order("code");
if (companyError) fail(companyError.message);
const company = companies.find((row) => row.code === "MARTIGROW") ?? companies[0];
if (!company) fail("No company found");

const { data: years } = await supabase
  .from("financial_years")
  .select("id, code, start_date, end_date")
  .eq("company_id", company.id)
  .order("start_date", { ascending: false });
let year = years?.[0];
if (!year) {
  const createdYear = await supabase
    .from("financial_years")
    .insert({
      company_id: company.id,
      code: "2026-27",
      start_date: "2026-04-01",
      end_date: "2027-03-31",
      is_closed: false,
    })
    .select("id, code")
    .single();
  if (createdYear.error) fail("FY insert failed", createdYear.error);
  year = createdYear.data;
}

const { data: profile } = await supabase.from("profiles").select("id").limit(1).maybeSingle();
const createdBy = profile?.id ?? null;

await supabase.rpc("seed_company_voucher_types", { p_company_id: company.id });
const { data: types } = await supabase
  .from("voucher_types")
  .select("id, code")
  .eq("company_id", company.id)
  .in("code", ["CASH-R", "CASH-P"]);
const receiptType = types?.find((row) => row.code === "CASH-R");
const paymentType = types?.find((row) => row.code === "CASH-P");
if (!receiptType || !paymentType) fail("CASH-R / CASH-P voucher types missing");

const neededGroups = [
  { code: "BS-CA", name: "Current Assets", nature: "asset" },
  { code: "BS-CASH", name: "Cash-in-hand", nature: "asset" },
  { code: "BS-DEB", name: "Sundry Debtors", nature: "asset" },
  { code: "PL-IE", name: "Indirect Expenses", nature: "expense" },
  { code: "PL-RENT", name: "Rent", nature: "expense" },
  { code: "PL-ADMIN", name: "Administrative Expenses", nature: "expense" },
  { code: "PL-FRT", name: "Freight Inward", nature: "expense" },
];
for (const group of neededGroups) {
  const { data: existingGroup } = await supabase
    .from("account_groups")
    .select("id")
    .eq("company_id", company.id)
    .eq("code", group.code)
    .maybeSingle();
  if (existingGroup?.id) continue;
  const inserted = await supabase.from("account_groups").insert({
    company_id: company.id,
    code: group.code,
    name: group.name,
    nature: group.nature,
  });
  if (inserted.error && inserted.error.code !== "23505") fail("Account group insert failed", inserted.error);
}
const { data: groups } = await supabase.from("account_groups").select("id, code").eq("company_id", company.id);
const groupId = (code) => groups?.find((row) => row.code === code)?.id ?? null;

const books = [
  { code: "CB1", name: "Cash Book 1" },
  { code: "CB2", name: "Cash Book 2" },
  { code: "CB3", name: "Cash Book 3" },
];
const locationIds = [];
for (const book of books) {
  locationIds.push(await ensureLocation(company.id, book.code, book.name, groupId("BS-CASH")));
}

const { data: locations } = await supabase
  .from("locations")
  .select("id, code, cash_ledger_id")
  .eq("company_id", company.id)
  .in("code", ["CB1", "CB2", "CB3"]);
const cashLedgerByLocation = Object.fromEntries(locations.map((row) => [row.id, row.cash_ledger_id]));

const expenseIds = {
  rent: await ensureExpenseLedger(company.id, "EXP-RENT", "Rent", groupId("PL-RENT")),
  elec: await ensureExpenseLedger(company.id, "EXP-ELEC", "Electricity", groupId("PL-ADMIN")),
  petrol: await ensureExpenseLedger(company.id, "EXP-PETROL", "Petrol", groupId("PL-ADMIN")),
  office: await ensureExpenseLedger(company.id, "EXP-OFFICE", "Office expense", groupId("PL-ADMIN")),
  freight: await ensureExpenseLedger(company.id, "EXP-FRT", "Freight", groupId("PL-FRT")),
};

const { data: parties } = await supabase
  .from("parties")
  .select("id, code, name")
  .is("deleted_at", null)
  .order("code")
  .limit(20);
if (!parties?.length) fail("No parties found");
const partyLedgers = [];
for (const party of parties) {
  partyLedgers.push({
    ...party,
    ledgerId: await ensurePartyLedger(company.id, party, groupId("BS-DEB") ?? groupId("BS-CA")),
  });
}
const pickParty = (i) => partyLedgers[i % partyLedgers.length];
const loc = (i) => locationIds[i];
const voucherDate = "2026-08-16";

const receipts = [
  { amount: 12000, i: 0, loc: 0, n: "Cash received from party — collection 1" },
  { amount: 8000, i: 1, loc: 0, n: "Cash received from party — collection 2" },
  { amount: 5500, i: 2, loc: 0, n: "Cash received from party — collection 3" },
  { amount: 3000, i: 3, loc: 0, n: "Cash received from party — collection 4" },
  { amount: 15000, i: 4, loc: 1, n: "Cash received from party — collection 5" },
  { amount: 4500, i: 0, loc: 1, n: "Cash received from party — collection 6" },
  { amount: 7000, i: 1, loc: 1, n: "Cash received from party — collection 7" },
  { amount: 2500, i: 2, loc: 2, n: "Cash received from party — collection 8" },
  { amount: 9000, i: 3, loc: 2, n: "Cash received from party — collection 9" },
  { amount: 2000, i: 4, loc: 2, n: "Cash received from party — collection 10" },
];

const payments = [
  { amount: 8500, loc: 0, expense: expenseIds.rent, n: "Cash paid — rent" },
  { amount: 2200, loc: 0, expense: expenseIds.elec, n: "Cash paid — electricity" },
  { amount: 5000, loc: 0, party: 0, n: "Cash paid to party — payment 1" },
  { amount: 1800, loc: 1, expense: expenseIds.petrol, n: "Cash paid — petrol" },
  { amount: 3500, loc: 1, party: 1, n: "Cash paid to party — payment 2" },
  { amount: 1200, loc: 1, expense: expenseIds.office, n: "Cash paid — office expense" },
  { amount: 4000, loc: 1, party: 2, n: "Cash paid to party — payment 3" },
  { amount: 2700, loc: 2, expense: expenseIds.freight, n: "Cash paid — freight" },
  { amount: 6000, loc: 2, party: 3, n: "Cash paid to party — payment 4" },
  { amount: 1500, loc: 2, party: 4, n: "Cash paid to party — payment 5" },
];

let receiptCount = 0;
for (const row of receipts) {
  const party = pickParty(row.i);
  await insertCashVoucher({
    companyId: company.id,
    locationId: loc(row.loc),
    financialYearId: year.id,
    voucherTypeId: receiptType.id,
    cashLedgerId: cashLedgerByLocation[loc(row.loc)],
    counterpartyLedgerId: party.ledgerId,
    partyId: party.id,
    voucherDate,
    amount: row.amount,
    narration: row.n,
    kind: "receipt",
    createdBy,
  });
  receiptCount += 1;
}

let paymentCount = 0;
for (const row of payments) {
  const party = row.party != null ? pickParty(row.party) : null;
  await insertCashVoucher({
    companyId: company.id,
    locationId: loc(row.loc),
    financialYearId: year.id,
    voucherTypeId: paymentType.id,
    cashLedgerId: cashLedgerByLocation[loc(row.loc)],
    counterpartyLedgerId: party?.ledgerId ?? row.expense,
    partyId: party?.id ?? null,
    voucherDate,
    amount: row.amount,
    narration: row.n,
    kind: "payment",
    createdBy,
  });
  paymentCount += 1;
}

console.log(
  JSON.stringify(
    {
      company: `${company.code} — ${company.name}`,
      year: year.code,
      locations: books.map((book) => book.name),
      receipts: receiptCount,
      payments: paymentCount,
      status: "draft (Approve/Post from Cash Book queue)",
    },
    null,
    2,
  ),
);
