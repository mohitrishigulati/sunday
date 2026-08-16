"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCompanyAccess, assertLocationAccess, assertPermission, requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/types";
import { defaultPartyHeadCode, insertBusyAccountGroups } from "@/lib/busy-account-groups";

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

const cashTransferSchema = z.object({ companyId:z.string().uuid(), financialYearId:z.string().uuid(), fromLocationId:z.string().uuid(), toLocationId:z.string().uuid(), clearingLedgerId:z.string().uuid(), transferDate:z.string().date(), amount:z.number().positive(), narration:z.string().trim().min(1).max(500) }).refine((value)=>value.fromLocationId!==value.toLocationId,"Source and destination locations must differ");
export async function createCashLocationTransfer(input:z.infer<typeof cashTransferSchema>):Promise<ActionResult<{groupId:string;fromVoucherId:string;toVoucherId:string}>>{
  const auth=await requireUser();if(!auth.ok)return auth;const permission=assertPermission(auth.data,"vouchers.draft");if(!permission.ok)return permission;const parsed=cashTransferSchema.safeParse(input);if(!parsed.success)return fail(parsed.error.issues[0]?.message??"Invalid cash transfer");const d=parsed.data;
  const companyAccess=await assertCompanyAccess(d.companyId,"write");if(!companyAccess.ok)return companyAccess;for(const locationId of [d.fromLocationId,d.toLocationId]){const access=await assertLocationAccess(locationId,"write");if(!access.ok)return access;}
  const supabase=await createClient();const[{data:locations},{data:year},{data:clearing},{data:types}]=await Promise.all([supabase.from("locations").select("id,company_id,cash_ledger_id,is_cash_location").in("id",[d.fromLocationId,d.toLocationId]),supabase.from("financial_years").select("id").eq("id",d.financialYearId).eq("company_id",d.companyId).maybeSingle(),supabase.from("ledgers").select("id,company_id,ledger_type").eq("id",d.clearingLedgerId).maybeSingle(),supabase.from("voucher_types").select("id,code").eq("company_id",d.companyId).in("code",["CASH-R","CASH-P"])]);
  if(!year||(locations??[]).length!==2||(locations??[]).some((location)=>location.company_id!==d.companyId||!location.is_cash_location||!location.cash_ledger_id))return fail("Financial year or cash locations are invalid");if(!clearing||clearing.company_id!==d.companyId||clearing.ledger_type==="cash")return fail("Select a non-cash transfer clearing ledger from the company");const receiptType=(types??[]).find((type)=>type.code==="CASH-R"),paymentType=(types??[]).find((type)=>type.code==="CASH-P");if(!receiptType||!paymentType)return fail("Cash receipt/payment voucher types are missing");
  const groupId=crypto.randomUUID();const byId=new Map((locations??[]).map((location)=>[location.id,location]));const make=async(locationId:string,typeId:string)=>supabase.from("vouchers").insert({company_id:d.companyId,location_id:locationId,financial_year_id:d.financialYearId,voucher_type_id:typeId,voucher_date:d.transferDate,draft_ref:`DRAFT-${crypto.randomUUID().slice(0,8)}`,narration:d.narration,created_by:auth.data.userId,cash_transfer_group_id:groupId}).select("id").single();const from=await make(d.fromLocationId,paymentType.id);const to=await make(d.toLocationId,receiptType.id);if(from.error||!from.data||to.error||!to.data){if(from.data)await supabase.from("vouchers").delete().eq("id",from.data.id);if(to.data)await supabase.from("vouchers").delete().eq("id",to.data.id);return fail(from.error?.message??to.error?.message??"Could not create cash transfer vouchers");}
  const{error}=await supabase.from("voucher_lines").insert([{voucher_id:from.data.id,line_no:1,company_id:d.companyId,location_id:d.fromLocationId,financial_year_id:d.financialYearId,ledger_id:d.clearingLedgerId,debit_amount:d.amount,credit_amount:0,narration:d.narration},{voucher_id:from.data.id,line_no:2,company_id:d.companyId,location_id:d.fromLocationId,financial_year_id:d.financialYearId,ledger_id:byId.get(d.fromLocationId)!.cash_ledger_id,debit_amount:0,credit_amount:d.amount,narration:d.narration},{voucher_id:to.data.id,line_no:1,company_id:d.companyId,location_id:d.toLocationId,financial_year_id:d.financialYearId,ledger_id:byId.get(d.toLocationId)!.cash_ledger_id,debit_amount:d.amount,credit_amount:0,narration:d.narration},{voucher_id:to.data.id,line_no:2,company_id:d.companyId,location_id:d.toLocationId,financial_year_id:d.financialYearId,ledger_id:d.clearingLedgerId,debit_amount:0,credit_amount:d.amount,narration:d.narration}]);if(error){await supabase.from("vouchers").delete().in("id",[from.data.id,to.data.id]);return fail(error.message);}revalidatePath("/cash-book");return ok({groupId,fromVoucherId:from.data.id,toVoucherId:to.data.id});
}
