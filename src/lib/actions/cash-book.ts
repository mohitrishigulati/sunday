"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCompanyAccess, assertLocationAccess, assertPermission, requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/types";
import { defaultPartyHeadCode, insertBusyAccountGroups } from "@/lib/busy-account-groups";
import { ensureIndianFinancialYear } from "@/lib/actions/masters";

type Db = Awaited<ReturnType<typeof createClient>>;

const cashEntrySchema = z.object({
  companyId: z.string().uuid(),
  locationId: z.string().uuid(),
  financialYearId: z.string().uuid(),
  voucherDate: z.string(),
  entryKind: z.enum(["receipt", "payment"]),
  counterpartyLedgerId: z.string().uuid().optional(),
  partyId: z.string().uuid().optional(),
  amount: z.coerce.number().positive(),
  narration: z.string().min(1),
}).refine((value) => Boolean(value.partyId || value.counterpartyLedgerId), {
  message: "Select Received from / Paid to party, or a ledger",
});

async function ensureCashVoucherType(supabase: Db, companyId: string, code: "CASH-R" | "CASH-P") {
  const first = await supabase
    .from("voucher_types")
    .select("id")
    .eq("company_id", companyId)
    .eq("code", code)
    .maybeSingle();
  if (first.data) return first.data;
  await supabase.rpc("seed_company_voucher_types", { p_company_id: companyId });
  const again = await supabase
    .from("voucher_types")
    .select("id")
    .eq("company_id", companyId)
    .eq("code", code)
    .maybeSingle();
  return again.data;
}

async function ensurePartyLedger(supabase: Db, companyId: string, partyId: string): Promise<string | null> {
  const { data: link } = await supabase
    .from("party_company_links")
    .select("ledger_id")
    .eq("party_id", partyId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (link?.ledger_id) return link.ledger_id;

  const { data: existing } = await supabase
    .from("ledgers")
    .select("id")
    .eq("company_id", companyId)
    .eq("party_id", partyId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .limit(1);
  if (existing?.[0]?.id) {
    await supabase.from("party_company_links").upsert(
      { party_id: partyId, company_id: companyId, ledger_id: existing[0].id },
      { onConflict: "party_id,company_id" },
    );
    return existing[0].id;
  }

  const { data: party } = await supabase
    .from("parties")
    .select("id, code, name, party_kinds")
    .eq("id", partyId)
    .maybeSingle();
  if (!party) return null;

  await insertBusyAccountGroups(supabase as never, companyId);
  const { data: group } = await supabase
    .from("account_groups")
    .select("id")
    .eq("company_id", companyId)
    .eq("code", defaultPartyHeadCode(party.party_kinds as string[] | undefined))
    .maybeSingle();

  const codes = [party.code.toUpperCase(), `${party.code.toUpperCase()}-P`];
  for (const code of codes) {
    const { data: ledger, error } = await supabase
      .from("ledgers")
      .insert({
        company_id: companyId,
        account_group_id: group?.id ?? null,
        code,
        name: party.name,
        ledger_type: "party",
        party_id: party.id,
        is_intercompany: false,
      })
      .select("id")
      .single();
    if (!error && ledger) {
      await supabase.from("party_company_links").upsert(
        { party_id: partyId, company_id: companyId, ledger_id: ledger.id },
        { onConflict: "party_id,company_id" },
      );
      return ledger.id;
    }
  }
  return null;
}

export async function ensureCashBookSetup(companyId: string): Promise<
  ActionResult<{
    locationId: string;
    financialYearId: string;
    locationLabel: string;
    yearCode: string;
  }>
> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!z.string().uuid().safeParse(companyId).success) return fail("Select a company");
  const access = await assertCompanyAccess(companyId, "write");
  if (!access.ok) return access;

  const supabase = await createClient();
  await insertBusyAccountGroups(supabase as never, companyId);
  await supabase.rpc("seed_company_voucher_types", { p_company_id: companyId });

  const year = await ensureIndianFinancialYear(companyId, new Date().toISOString().slice(0, 10));
  if (!year.ok) return year;

  const { data: cashLocations } = await supabase
    .from("locations")
    .select("id, code, name, cash_ledger_id, is_cash_location")
    .eq("company_id", companyId)
    .eq("is_cash_location", true)
    .not("cash_ledger_id", "is", null)
    .limit(1);
  let location = cashLocations?.[0] ?? null;

  if (!location) {
    await insertBusyAccountGroups(supabase as never, companyId);
    const { data: cashGroup } = await supabase
      .from("account_groups")
      .select("id")
      .eq("company_id", companyId)
      .eq("code", "BS-CASH")
      .maybeSingle();
    let { data: cashLedger } = await supabase
      .from("ledgers")
      .select("id")
      .eq("company_id", companyId)
      .eq("ledger_type", "cash")
      .eq("is_active", true)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (!cashLedger) {
      const created = await supabase
        .from("ledgers")
        .insert({
          company_id: companyId,
          account_group_id: cashGroup?.id ?? null,
          code: "CASH-HQ",
          name: "Cash-in-hand",
          ledger_type: "cash",
          is_intercompany: false,
        })
        .select("id")
        .single();
      if (created.error || !created.data) {
        return fail(created.error?.message ?? "Cash ledger bana nahi. Location Master se cash register banao.");
      }
      cashLedger = created.data;
    }

    const { data: anyLocation } = await supabase
      .from("locations")
      .select("id, code, name")
      .eq("company_id", companyId)
      .limit(1)
      .maybeSingle();
    if (anyLocation) {
      const updated = await supabase
        .from("locations")
        .update({ is_cash_location: true, cash_ledger_id: cashLedger.id })
        .eq("id", anyLocation.id)
        .select("id, code, name")
        .single();
      if (updated.error || !updated.data) {
        return fail(updated.error?.message ?? "Cash location update nahi hua");
      }
      location = { ...updated.data, cash_ledger_id: cashLedger.id, is_cash_location: true };
    } else {
      const createdLoc = await supabase
        .from("locations")
        .insert({
          company_id: companyId,
          code: "HQ",
          name: "Head office",
          location_type: "cash_counter",
          is_cash_location: true,
          cash_ledger_id: cashLedger.id,
        })
        .select("id, code, name")
        .single();
      if (createdLoc.error || !createdLoc.data) {
        return fail(createdLoc.error?.message ?? "Cash register bana nahi. Location Master mein HQ cash counter banao.");
      }
      location = { ...createdLoc.data, cash_ledger_id: cashLedger.id, is_cash_location: true };
    }
  }

  revalidatePath("/cash-book");
  revalidatePath("/transactions/receipt");
  revalidatePath("/transactions/payment");
  return ok({
    locationId: location.id,
    financialYearId: year.data.id,
    locationLabel: `${location.code} — ${location.name}`,
    yearCode: year.data.code,
  });
}

export async function createCashRegisterLocation(input: {
  companyId: string;
  code: string;
  name: string;
}): Promise<ActionResult<{ id: string; code: string; name: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = z
    .object({
      companyId: z.string().uuid(),
      code: z.string().trim().min(1).max(16),
      name: z.string().trim().min(1).max(200),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Location code aur name bharo.");
  const access = await assertCompanyAccess(parsed.data.companyId, "write");
  if (!access.ok) return access;

  const supabase = await createClient();
  await insertBusyAccountGroups(supabase as never, parsed.data.companyId);
  const { data: cashGroup } = await supabase
    .from("account_groups")
    .select("id")
    .eq("company_id", parsed.data.companyId)
    .eq("code", "BS-CASH")
    .maybeSingle();
  const { data: cashLedger, error: cashLedgerError } = await supabase
    .from("ledgers")
    .insert({
      company_id: parsed.data.companyId,
      account_group_id: cashGroup?.id ?? null,
      code: `CASH-${parsed.data.code.toUpperCase()}`,
      name: `${parsed.data.name} Cash`,
      ledger_type: "cash",
      is_intercompany: false,
    })
    .select("id")
    .single();
  if (cashLedgerError || !cashLedger) {
    return fail(cashLedgerError?.message ?? "Cash ledger nahi bana");
  }
  const { data: location, error } = await supabase
    .from("locations")
    .insert({
      company_id: parsed.data.companyId,
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
      location_type: "cash_counter",
      is_cash_location: true,
      cash_ledger_id: cashLedger.id,
    })
    .select("id, code, name")
    .single();
  if (error || !location) {
    await supabase.from("ledgers").delete().eq("id", cashLedger.id);
    return fail(error?.message ?? "Cash location nahi bani");
  }
  revalidatePath("/cash-book");
  return ok(location);
}

export async function createCashBookEntry(
  input: z.infer<typeof cashEntrySchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const draftPermission = assertPermission(auth.data, "vouchers.draft");
  if (!draftPermission.ok) return draftPermission;

  const parsed = cashEntrySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid cash entry");
  const data = parsed.data;

  const companyAccess = await assertCompanyAccess(data.companyId, "write");
  if (!companyAccess.ok) return companyAccess;
  const locationAccess = await assertLocationAccess(data.locationId, "write");
  if (!locationAccess.ok) return locationAccess;

  const supabase = await createClient();
  const [{ data: location, error: locationError }, voucherType] = await Promise.all([
    supabase
      .from("locations")
      .select("company_id, cash_ledger_id, is_cash_location")
      .eq("id", data.locationId)
      .maybeSingle(),
    ensureCashVoucherType(supabase, data.companyId, data.entryKind === "receipt" ? "CASH-R" : "CASH-P"),
  ]);

  if (locationError || !location || location.company_id !== data.companyId || !location.is_cash_location || !location.cash_ledger_id) {
    return fail("Select a cash location with an assigned cash ledger");
  }
  if (!voucherType) return fail("Cash voucher type is not configured for this company");

  let counterpartyLedgerId = data.counterpartyLedgerId;
  let partyId = data.partyId ?? null;
  if (data.partyId) {
    counterpartyLedgerId = (await ensurePartyLedger(supabase, data.companyId, data.partyId)) ?? counterpartyLedgerId;
    if (!counterpartyLedgerId) {
      return fail("Is party ka ledger is company mein nahi hai. Other ledger select karo, ya Party Master mein ledger banao.");
    }
  }
  if (!counterpartyLedgerId) return fail("Select Received from / Paid to");

  const { data: counterparty, error: counterpartyError } = await supabase
    .from("ledgers")
    .select("id,party_id")
    .eq("id", counterpartyLedgerId)
    .eq("company_id", data.companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (counterpartyError || !counterparty || counterparty.id === location.cash_ledger_id) {
    return fail("Select an active non-cash counterparty ledger from the same company");
  }
  partyId = partyId ?? counterparty.party_id ?? null;

  const { data: voucher, error: voucherError } = await supabase
    .from("vouchers")
    .insert({
      company_id: data.companyId,
      location_id: data.locationId,
      financial_year_id: data.financialYearId,
      voucher_type_id: voucherType.id,
      voucher_date: data.voucherDate,
      draft_ref: `DRAFT-${crypto.randomUUID().slice(0, 8)}`,
      narration: data.narration,
      party_id: partyId,
      created_by: auth.data.userId,
    })
    .select("id")
    .single();
  if (voucherError || !voucher) return fail(voucherError?.message ?? "Could not save cash entry");

  const cashIsDebit = data.entryKind === "receipt";
  const { error: linesError } = await supabase.from("voucher_lines").insert([
    {
      voucher_id: voucher.id,
      line_no: 1,
      company_id: data.companyId,
      location_id: data.locationId,
      financial_year_id: data.financialYearId,
      ledger_id: location.cash_ledger_id,
      debit_amount: cashIsDebit ? data.amount : 0,
      credit_amount: cashIsDebit ? 0 : data.amount,
      narration: data.narration,
    },
    {
      voucher_id: voucher.id,
      line_no: 2,
      company_id: data.companyId,
      location_id: data.locationId,
      financial_year_id: data.financialYearId,
      ledger_id: counterpartyLedgerId,
      party_id: partyId,
      debit_amount: cashIsDebit ? 0 : data.amount,
      credit_amount: cashIsDebit ? data.amount : 0,
      narration: data.narration,
    },
  ]);
  if (linesError) {
    await supabase.from("vouchers").delete().eq("id", voucher.id);
    return fail(linesError.message);
  }

  revalidatePath("/cash-book");
  revalidatePath("/transactions/receipt");
  revalidatePath("/transactions/payment");
  return ok({ id: voucher.id });
}

export async function createFourSampleCashEntries(input: {
  companyId: string;
  locationId: string;
  financialYearId: string;
  voucherDate: string;
}): Promise<ActionResult<{ count: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = z
    .object({
      companyId: z.string().uuid(),
      locationId: z.string().uuid(),
      financialYearId: z.string().uuid(),
      voucherDate: z.string().min(8),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Pehle company, cash register, year aur date select karo.");

  const supabase = await createClient();
  const { data: ledgers } = await supabase
    .from("ledgers")
    .select("id, party_id, ledger_type")
    .eq("company_id", parsed.data.companyId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .neq("ledger_type", "cash")
    .limit(8);
  const counterparts = (ledgers ?? []).filter((ledger) => ledger.ledger_type !== "cash");
  if (!counterparts.length) {
    return fail("Is company mein party/ledger nahi hai. Pehle Party Master ya Ledger banao.");
  }

  const pick = (index: number) => counterparts[index % counterparts.length];
  const samples = [
    { entryKind: "receipt" as const, amount: 10000, narration: "Cash received — sample 1", party: pick(0) },
    { entryKind: "receipt" as const, amount: 7500, narration: "Cash received — sample 2", party: pick(1) },
    { entryKind: "payment" as const, amount: 2500, narration: "Cash paid — sample 3", party: pick(2) },
    { entryKind: "payment" as const, amount: 4000, narration: "Cash paid — sample 4", party: pick(3) },
  ];

  for (const sample of samples) {
    const result = await createCashBookEntry({
      companyId: parsed.data.companyId,
      locationId: parsed.data.locationId,
      financialYearId: parsed.data.financialYearId,
      voucherDate: parsed.data.voucherDate,
      entryKind: sample.entryKind,
      partyId: sample.party.party_id ?? undefined,
      counterpartyLedgerId: sample.party.id,
      amount: sample.amount,
      narration: sample.narration,
    });
    if (!result.ok) return result;
  }

  revalidatePath("/cash-book");
  return ok({ count: 4 });
}

const THREE_CASH_BOOKS = [
  { code: "CB1", name: "Cash Book 1" },
  { code: "CB2", name: "Cash Book 2" },
  { code: "CB3", name: "Cash Book 3" },
] as const;

const EXPENSE_SEED_LEDGERS = [
  { code: "EXP-RENT", name: "Rent", group: "PL-RENT" },
  { code: "EXP-ELEC", name: "Electricity", group: "PL-ADMIN" },
  { code: "EXP-PETROL", name: "Petrol", group: "PL-ADMIN" },
  { code: "EXP-OFFICE", name: "Office expense", group: "PL-ADMIN" },
  { code: "EXP-FRT", name: "Freight", group: "PL-FRT" },
] as const;

export async function seedThreeCashBooksWithTwentyEntries(input: {
  companyId: string;
  voucherDate?: string;
}): Promise<ActionResult<{ locations: number; receipts: number; payments: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = z.object({ companyId: z.string().uuid(), voucherDate: z.string().min(8).optional() }).safeParse(input);
  if (!parsed.success) return fail("Select a company");
  const access = await assertCompanyAccess(parsed.data.companyId, "write");
  if (!access.ok) return access;

  const setup = await ensureCashBookSetup(parsed.data.companyId);
  if (!setup.ok) return setup;

  const supabase = await createClient();
  const voucherDate = parsed.data.voucherDate ?? new Date().toISOString().slice(0, 10);
  const locationIds: string[] = [];

  for (const book of THREE_CASH_BOOKS) {
    const { data: existing } = await supabase
      .from("locations")
      .select("id")
      .eq("company_id", parsed.data.companyId)
      .eq("code", book.code)
      .maybeSingle();
    if (existing?.id) {
      locationIds.push(existing.id);
      continue;
    }
    const created = await createCashRegisterLocation({
      companyId: parsed.data.companyId,
      code: book.code,
      name: book.name,
    });
    if (!created.ok) return created;
    locationIds.push(created.data.id);
  }

  await insertBusyAccountGroups(supabase as never, parsed.data.companyId);
  const { data: groups } = await supabase
    .from("account_groups")
    .select("id, code")
    .eq("company_id", parsed.data.companyId);
  const groupId = (code: string) => groups?.find((row) => row.code === code)?.id ?? null;

  for (const expense of EXPENSE_SEED_LEDGERS) {
    const { data: existing } = await supabase
      .from("ledgers")
      .select("id")
      .eq("company_id", parsed.data.companyId)
      .eq("code", expense.code)
      .maybeSingle();
    if (existing?.id) continue;
    await supabase.from("ledgers").insert({
      company_id: parsed.data.companyId,
      account_group_id: groupId(expense.group),
      code: expense.code,
      name: expense.name,
      ledger_type: "general",
      is_intercompany: false,
    });
  }

  const { data: parties } = await supabase
    .from("parties")
    .select("id, code")
    .is("deleted_at", null)
    .order("code")
    .limit(20);
  if (!parties?.length) return fail("Pehle Party Master mein parties banao.");

  const expenseLedgers: Array<{ id: string; code: string }> = [];
  for (const expense of EXPENSE_SEED_LEDGERS) {
    const { data: ledger } = await supabase
      .from("ledgers")
      .select("id, code")
      .eq("company_id", parsed.data.companyId)
      .eq("code", expense.code)
      .maybeSingle();
    if (ledger) expenseLedgers.push(ledger);
  }

  const pickParty = (index: number) => parties[index % parties.length];
  const pickExpense = (index: number) => expenseLedgers[index % expenseLedgers.length];
  const loc = (index: number) => locationIds[index % locationIds.length];

  const receipts = [
    { amount: 12000, narration: "Cash received from party — collection 1", party: pickParty(0), locationId: loc(0) },
    { amount: 8000, narration: "Cash received from party — collection 2", party: pickParty(1), locationId: loc(0) },
    { amount: 5500, narration: "Cash received from party — collection 3", party: pickParty(2), locationId: loc(0) },
    { amount: 3000, narration: "Cash received from party — collection 4", party: pickParty(3), locationId: loc(0) },
    { amount: 15000, narration: "Cash received from party — collection 5", party: pickParty(4), locationId: loc(1) },
    { amount: 4500, narration: "Cash received from party — collection 6", party: pickParty(0), locationId: loc(1) },
    { amount: 7000, narration: "Cash received from party — collection 7", party: pickParty(1), locationId: loc(1) },
    { amount: 2500, narration: "Cash received from party — collection 8", party: pickParty(2), locationId: loc(2) },
    { amount: 9000, narration: "Cash received from party — collection 9", party: pickParty(3), locationId: loc(2) },
    { amount: 2000, narration: "Cash received from party — collection 10", party: pickParty(4), locationId: loc(2) },
  ];

  const payments: Array<{
    amount: number;
    narration: string;
    locationId: string;
    partyId?: string;
    counterpartyLedgerId?: string;
  }> = [
    { amount: 8500, narration: "Cash paid — rent", locationId: loc(0), counterpartyLedgerId: pickExpense(0)?.id },
    { amount: 2200, narration: "Cash paid — electricity", locationId: loc(0), counterpartyLedgerId: pickExpense(1)?.id },
    { amount: 5000, narration: "Cash paid to party — payment 1", locationId: loc(0), partyId: pickParty(0).id },
    { amount: 1800, narration: "Cash paid — petrol", locationId: loc(1), counterpartyLedgerId: pickExpense(2)?.id },
    { amount: 3500, narration: "Cash paid to party — payment 2", locationId: loc(1), partyId: pickParty(1).id },
    { amount: 1200, narration: "Cash paid — office expense", locationId: loc(1), counterpartyLedgerId: pickExpense(3)?.id },
    { amount: 4000, narration: "Cash paid to party — payment 3", locationId: loc(1), partyId: pickParty(2).id },
    { amount: 2700, narration: "Cash paid — freight", locationId: loc(2), counterpartyLedgerId: pickExpense(4)?.id },
    { amount: 6000, narration: "Cash paid to party — payment 4", locationId: loc(2), partyId: pickParty(3).id },
    { amount: 1500, narration: "Cash paid to party — payment 5", locationId: loc(2), partyId: pickParty(4).id },
  ];

  for (const receipt of receipts) {
    const result = await createCashBookEntry({
      companyId: parsed.data.companyId,
      locationId: receipt.locationId,
      financialYearId: setup.data.financialYearId,
      voucherDate,
      entryKind: "receipt",
      partyId: receipt.party.id,
      amount: receipt.amount,
      narration: receipt.narration,
    });
    if (!result.ok) return result;
  }

  for (const payment of payments) {
    if (!payment.partyId && !payment.counterpartyLedgerId) {
      return fail("Expense ledger nahi bana. Ledger Master check karo.");
    }
    const result = await createCashBookEntry({
      companyId: parsed.data.companyId,
      locationId: payment.locationId,
      financialYearId: setup.data.financialYearId,
      voucherDate,
      entryKind: "payment",
      partyId: payment.partyId,
      counterpartyLedgerId: payment.counterpartyLedgerId,
      amount: payment.amount,
      narration: payment.narration,
    });
    if (!result.ok) return result;
  }

  revalidatePath("/cash-book");
  return ok({ locations: locationIds.length, receipts: receipts.length, payments: payments.length });
}

const cashVerificationSchema = z.object({
  companyId: z.string().uuid(),
  locationId: z.string().uuid(),
  verificationDate: z.string().date(),
  physicalCashBalance: z.number().nonnegative(),
  notes: z.string().trim().max(1000).optional(),
});

export async function verifyPhysicalCash(
  input: z.infer<typeof cashVerificationSchema>,
): Promise<ActionResult<{ id: string; systemBalance: number; difference: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = cashVerificationSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid cash verification");
  const companyAccess = await assertCompanyAccess(parsed.data.companyId, "write");
  if (!companyAccess.ok) return companyAccess;
  const locationAccess = await assertLocationAccess(parsed.data.locationId, "write");
  if (!locationAccess.ok) return locationAccess;
  const supabase = await createClient();
  const { data: location } = await supabase.from("locations").select("company_id,cash_ledger_id").eq("id", parsed.data.locationId).maybeSingle();
  if (!location || location.company_id !== parsed.data.companyId || !location.cash_ledger_id) return fail("Cash location is not configured");
  const { data: postings, error: postingsError } = await supabase.from("ledger_postings").select("debit_amount,credit_amount").eq("company_id", parsed.data.companyId).eq("location_id", parsed.data.locationId).eq("ledger_id", location.cash_ledger_id).lte("voucher_date", parsed.data.verificationDate);
  if (postingsError) return fail(postingsError.message);
  const systemBalance = Number((postings ?? []).reduce((sum, row) => sum + Number(row.debit_amount) - Number(row.credit_amount), 0).toFixed(4));
  const { data, error } = await supabase.from("cash_verifications").upsert({ company_id: parsed.data.companyId, location_id: parsed.data.locationId, verification_date: parsed.data.verificationDate, system_cash_balance: systemBalance, physical_cash_balance: parsed.data.physicalCashBalance, notes: parsed.data.notes ?? null, verified_by: auth.data.userId }, { onConflict: "location_id,verification_date" }).select("id").single();
  if (error || !data) return fail(error?.message ?? "Could not save physical cash verification");
  revalidatePath("/cash-book");
  return ok({ id: data.id, systemBalance, difference: Number((parsed.data.physicalCashBalance - systemBalance).toFixed(4)) });
}

const cashTransferSchema = z.object({ companyId:z.string().uuid(), financialYearId:z.string().uuid(), fromLocationId:z.string().uuid(), toLocationId:z.string().uuid(), clearingLedgerId:z.string().uuid(), transferDate:z.string().date(), amount:z.string().trim().regex(/^\d{1,14}(\.\d{1,4})?$/,"Amount must be a number with at most 4 decimal places").refine((v)=>/[1-9]/.test(v),"Amount must be greater than zero"), narration:z.string().trim().min(1).max(500) }).refine((value)=>value.fromLocationId!==value.toLocationId,"Source and destination locations must differ");
/**
 * Both location vouchers and all four lines are written by
 * create_location_cash_transfer in one transaction. The previous version issued
 * five statements with compensating deletes, so a failure part-way could leave
 * one location's cash book showing a transfer the other never received.
 */
export async function createCashLocationTransfer(input:z.infer<typeof cashTransferSchema>):Promise<ActionResult<{groupId:string;fromVoucherId:string;toVoucherId:string}>>{
  const auth=await requireUser();if(!auth.ok)return auth;
  const permission=assertPermission(auth.data,"vouchers.draft");if(!permission.ok)return permission;
  const parsed=cashTransferSchema.safeParse(input);if(!parsed.success)return fail(parsed.error.issues[0]?.message??"Invalid cash transfer");
  const d=parsed.data;
  const companyAccess=await assertCompanyAccess(d.companyId,"write");if(!companyAccess.ok)return companyAccess;
  for(const locationId of [d.fromLocationId,d.toLocationId]){const access=await assertLocationAccess(locationId,"write");if(!access.ok)return access;}
  const supabase=await createClient();
  const{data,error}=await supabase.rpc("create_location_cash_transfer",{p_payload:{
    company_id:d.companyId,
    financial_year_id:d.financialYearId,
    from_location_id:d.fromLocationId,
    to_location_id:d.toLocationId,
    clearing_ledger_id:d.clearingLedgerId,
    transfer_date:d.transferDate,
    amount:d.amount,
    narration:d.narration,
  }});
  if(error)return fail(error.message);
  const result=data as{group_id?:string;from_voucher_id?:string;to_voucher_id?:string}|null;
  if(!result?.group_id||!result.from_voucher_id||!result.to_voucher_id)return fail("Could not create cash transfer");
  revalidatePath("/cash-book");revalidatePath("/reports");
  return ok({groupId:result.group_id,fromVoucherId:result.from_voucher_id,toVoucherId:result.to_voucher_id});
}
