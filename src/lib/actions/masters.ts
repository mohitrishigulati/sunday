"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  assertCompanyAccess,
  assertPermission,
  requireUser,
} from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/types";
import { indianFinancialYearForDate, indianFinancialYearsCovering } from "@/lib/financial-year";
import { insertBusyAccountGroups } from "@/lib/busy-account-groups";

const companySchema = z.object({
  groupId: z.string().uuid(),
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().max(200).optional(),
  gstin: z.string().trim().max(15).optional(),
  stateCode: z.string().trim().length(2).optional(),
  pan: z.string().trim().max(10).optional(),
  cashHeadCode: z.string().trim().min(1).optional(),
  bankHeadCode: z.string().trim().min(1).optional(),
});

export async function createCompany(
  input: z.infer<typeof companySchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  // RLS (companies_manage / user_company_access_admin) only lets admins insert a
  // company and grant access to it. Gate here too so the caller gets a clear
  // message instead of an opaque row-level-security error.
  if (!auth.data.roles.includes("admin")) {
    return fail("Only an admin can create a company");
  }

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .insert({
      group_id: parsed.data.groupId,
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
      legal_name: parsed.data.legalName || null,
      gstin: parsed.data.gstin || null,
      state_code: parsed.data.stateCode || null,
      pan: parsed.data.pan || null,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Failed to create company");

  await supabase.rpc("seed_company_voucher_types", {
    p_company_id: data.id,
  });

  // Grant the creating admin full access
  await supabase.from("user_company_access").upsert({
    user_id: auth.data.userId,
    company_id: data.id,
    can_read: true,
    can_write: true,
    can_approve: true,
    can_manage: true,
  });

  const seeded = await insertBusyAccountGroups(supabase as never, data.id);
  if (!seeded.ok) return fail(seeded.error);

  const cashHeadCode = parsed.data.cashHeadCode || "BS-CASH";
  const bankHeadCode = parsed.data.bankHeadCode || "BS-BANK";
  const { data: cashGroup } = await supabase
    .from("account_groups")
    .select("id")
    .eq("company_id", data.id)
    .eq("code", cashHeadCode)
    .maybeSingle();
  const { data: bankGroup } = await supabase
    .from("account_groups")
    .select("id")
    .eq("company_id", data.id)
    .eq("code", bankHeadCode)
    .maybeSingle();
  await supabase.from("ledgers").insert({
    company_id: data.id,
    account_group_id: cashGroup?.id ?? bankGroup?.id ?? null,
    code: `CASH-${parsed.data.code.toUpperCase()}`,
    name: "Cash-in-hand",
    ledger_type: "cash",
    is_intercompany: false,
  });

  await ensureIndianFinancialYear(data.id, new Date().toISOString().slice(0, 10));

  revalidatePath("/masters/companies");
  revalidatePath("/masters/financial-years");
  revalidatePath("/dashboard");
  revalidatePath("/bank-import");
  revalidatePath("/bank-book");
  revalidatePath("/journals");
  return ok({ id: data.id });
}

const locationSchema = z.object({
  companyId: z.string().uuid(),
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(200),
  locationType: z.enum(["branch", "warehouse", "cash_counter"]),
  isCashLocation: z.boolean().default(false),
  cashLedgerId: z.string().uuid().optional(),
  cashAccountGroupId: z.string().uuid().optional(),
  parentLocationId: z.string().uuid().optional(),
});

export async function createLocation(
  input: z.infer<typeof locationSchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = locationSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const access = await assertCompanyAccess(parsed.data.companyId, "manage");
  if (!access.ok) return access;

  const supabase = await createClient();
  const isCashLocation =
    parsed.data.isCashLocation || parsed.data.locationType === "cash_counter";
  let cashLedgerId = parsed.data.cashLedgerId || null;
  let createdCashLedgerId: string | null = null;

  if (cashLedgerId) {
    const { data: cashLedger } = await supabase
      .from("ledgers")
      .select("id, company_id, ledger_type, is_active")
      .eq("id", cashLedgerId)
      .maybeSingle();
    if (
      !cashLedger ||
      cashLedger.company_id !== parsed.data.companyId ||
      cashLedger.ledger_type !== "cash" ||
      !cashLedger.is_active
    ) {
      return fail("Cash ledger must be an active cash ledger of the same company");
    }
  }

  // A cash location must always be usable immediately. If the user does not
  // select an existing cash ledger, create a dedicated one for the location.
  if (isCashLocation && !cashLedgerId) {
    const { data: cashGroup } = parsed.data.cashAccountGroupId
      ? await supabase
          .from("account_groups")
          .select("id")
          .eq("id", parsed.data.cashAccountGroupId)
          .eq("company_id", parsed.data.companyId)
          .maybeSingle()
      : await supabase
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
      return fail(cashLedgerError?.message ?? "Failed to create location cash ledger");
    }
    cashLedgerId = cashLedger.id;
    createdCashLedgerId = cashLedger.id;
  }

  const { data, error } = await supabase
    .from("locations")
    .insert({
      company_id: parsed.data.companyId,
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
      location_type: parsed.data.locationType,
      is_cash_location: isCashLocation,
      cash_ledger_id: isCashLocation ? cashLedgerId : null,
      parent_location_id: parsed.data.parentLocationId || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (createdCashLedgerId) {
      await supabase.from("ledgers").delete().eq("id", createdCashLedgerId);
    }
    return fail(error?.message ?? "Failed to create location");
  }

  revalidatePath("/masters/locations");
  return ok({ id: data.id });
}

const bankAccountSchema = z.object({
  companyId: z.string().uuid(),
  bankId: z.string().uuid().optional(),
  accountName: z.string().trim().min(1),
  accountNumber: z.string().trim().min(1),
  ifsc: z.string().trim().optional(),
  accountType: z.enum(["current", "savings", "od", "cc"]).optional(),
  ledgerCode: z.string().trim().min(1),
  ledgerName: z.string().trim().min(1),
  accountGroupId: z.string().uuid().optional(),
});

const bankMasterSchema = z.object({
  code: z.string().trim().min(2).max(16),
  name: z.string().trim().min(2).max(200),
});

export async function createBankMaster(
  input: z.infer<typeof bankMasterSchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!auth.data.roles.includes("admin")) return fail("Only an admin can add a bank name");
  const parsed = bankMasterSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid bank");
  const supabase = await createClient();
  const { data, error } = await supabase.from("banks").insert({ code: parsed.data.code.toUpperCase(), name: parsed.data.name }).select("id").single();
  if (error || !data) return fail(error?.message ?? "Could not add bank");
  for (const path of ["/masters/bank-accounts", "/dashboard", "/bank-import", "/bank-book", "/journals"]) revalidatePath(path);
  return ok({ id: data.id });
}

export async function createBankAccount(
  input: z.infer<typeof bankAccountSchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = bankAccountSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const access = await assertCompanyAccess(parsed.data.companyId, "manage");
  if (!access.ok) return access;

  const supabase = await createClient();

  const { data: bankGroup } = parsed.data.accountGroupId
    ? await supabase
        .from("account_groups")
        .select("id")
        .eq("id", parsed.data.accountGroupId)
        .eq("company_id", parsed.data.companyId)
        .maybeSingle()
    : await supabase
        .from("account_groups")
        .select("id")
        .eq("company_id", parsed.data.companyId)
        .eq("code", "BS-BANK")
        .maybeSingle();

  const { data: ledger, error: ledgerError } = await supabase
    .from("ledgers")
    .insert({
      company_id: parsed.data.companyId,
      account_group_id: bankGroup?.id ?? null,
      code: parsed.data.ledgerCode.toUpperCase(),
      name: parsed.data.ledgerName,
      ledger_type: "bank",
      is_intercompany: false,
    })
    .select("id")
    .single();

  if (ledgerError || !ledger) {
    return fail(ledgerError?.message ?? "Failed to create bank ledger");
  }

  const { data, error } = await supabase
    .from("bank_accounts")
    .insert({
      company_id: parsed.data.companyId,
      bank_id: parsed.data.bankId || null,
      ledger_id: ledger.id,
      account_name: parsed.data.accountName,
      account_number: parsed.data.accountNumber,
      ifsc: parsed.data.ifsc || null,
      account_type: parsed.data.accountType || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    // Roll back the ledger, otherwise its code stays taken and a retry with the
    // same ledger code fails on the (company_id, code) unique constraint.
    await supabase.from("ledgers").delete().eq("id", ledger.id);
    return fail(error?.message ?? "Failed to create bank account");
  }

  revalidatePath("/masters/bank-accounts");
  revalidatePath("/dashboard");
  revalidatePath("/bank-import");
  revalidatePath("/bank-book");
  revalidatePath("/journals");
  return ok({ id: data.id });
}

const accountGroupSchema = z.object({
  companyId: z.string().uuid(),
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200),
  nature: z.enum(["asset", "liability", "equity", "income", "expense"]),
  bsPlSection: z.string().trim().max(100).optional(),
  cashFlowCategory: z.enum(["operating", "investing", "financing", "cash_equivalent"]).optional(),
  workingCapitalClass: z.enum(["current_asset", "current_liability", "non_current"]).optional(),
  parentId: z.string().uuid().optional(),
  isIntercompany: z.boolean().default(false),
});

export async function createAccountGroup(
  input: z.infer<typeof accountGroupSchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = accountGroupSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const access = await assertCompanyAccess(parsed.data.companyId, "manage");
  if (!access.ok) return access;

  const supabase = await createClient();

  // A parent from another company would produce a group tree that spans books.
  if (parsed.data.parentId) {
    const { data: parent } = await supabase
      .from("account_groups")
      .select("company_id, nature")
      .eq("id", parsed.data.parentId)
      .maybeSingle();

    if (!parent) return fail("Parent group not found");
    if (parent.company_id !== parsed.data.companyId) {
      return fail("Parent group belongs to a different company");
    }
    if (parent.nature !== parsed.data.nature) {
      return fail(`Parent group nature is ${parent.nature}; child must match`);
    }
  }

  const { data, error } = await supabase
    .from("account_groups")
    .insert({
      company_id: parsed.data.companyId,
      parent_id: parsed.data.parentId || null,
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
      nature: parsed.data.nature,
      bs_pl_section: parsed.data.bsPlSection || null,
      cash_flow_category: parsed.data.cashFlowCategory || null,
      working_capital_class: parsed.data.workingCapitalClass || null,
      is_intercompany: parsed.data.isIntercompany,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Failed to create account group");

  revalidatePath("/masters/account-groups");
  revalidatePath("/masters/ledgers");
  return ok({ id: data.id });
}

export async function seedBusyAccountGroups(
  companyId: string,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = z.string().uuid().safeParse(companyId);
  if (!parsed.success) return fail("Select a company");

  const access = await assertCompanyAccess(parsed.data, "manage");
  if (!access.ok) return access;

  const supabase = await createClient();
  const inserted = await insertBusyAccountGroups(supabase as never, parsed.data);
  if (!inserted.ok) return fail(inserted.error);

  revalidatePath("/masters/account-groups");
  revalidatePath("/masters/ledgers");
  revalidatePath("/reports");
  return ok({ id: parsed.data });
}

export async function seedBusyAccountGroupsForAllCompanies(): Promise<
  ActionResult<{ id: string; count: number }>
> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!auth.data.roles.includes("admin")) {
    return fail("Only an admin can seed heads for every company");
  }

  const supabase = await createClient();
  const { data: companies, error } = await supabase
    .from("companies")
    .select("id")
    .is("deleted_at", null);
  if (error) return fail(error.message);

  for (const company of companies ?? []) {
    const inserted = await insertBusyAccountGroups(supabase as never, company.id);
    if (!inserted.ok) return fail(inserted.error);
  }

  revalidatePath("/masters/account-groups");
  revalidatePath("/masters/ledgers");
  revalidatePath("/reports");
  return ok({ id: auth.data.userId, count: companies?.length ?? 0 });
}

const ledgerSchema = z.object({
  companyId: z.string().uuid(),
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  ledgerType: z.enum([
    "general",
    "cash",
    "bank",
    "party",
    "intercompany_receivable",
    "intercompany_payable",
    "intercompany_income",
    "intercompany_expense",
  ]),
  accountGroupId: z.string().uuid().optional(),
  counterpartCompanyId: z.string().uuid().optional(),
  partyId: z.string().uuid().optional(),
});

export async function createLedger(
  input: z.infer<typeof ledgerSchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = ledgerSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const access = await assertCompanyAccess(parsed.data.companyId, "manage");
  if (!access.ok) return access;

  const isIc = parsed.data.ledgerType.startsWith("intercompany_");
  if (isIc && !parsed.data.counterpartCompanyId) {
    return fail("Inter-company ledgers require counterpart company");
  }

  const supabase = await createClient();

  // account_groups has no company check of its own, so a ledger could otherwise
  // be filed under another company's group and corrupt that company's reports.
  if (parsed.data.accountGroupId) {
    const { data: group } = await supabase
      .from("account_groups")
      .select("company_id")
      .eq("id", parsed.data.accountGroupId)
      .maybeSingle();

    if (!group) return fail("Account group not found");
    if (group.company_id !== parsed.data.companyId) {
      return fail("Account group belongs to a different company");
    }
  }
  const { data, error } = await supabase
    .from("ledgers")
    .insert({
      company_id: parsed.data.companyId,
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
      ledger_type: parsed.data.ledgerType,
      account_group_id: parsed.data.accountGroupId || null,
      // Counterpart only means something for inter-company ledgers; never let a
      // stray selection persist on a general/cash/bank/party ledger.
      counterpart_company_id: isIc ? parsed.data.counterpartCompanyId : null,
      party_id: parsed.data.partyId || null,
      is_intercompany: isIc,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Failed to create ledger");

  revalidatePath("/masters/ledgers");
  return ok({ id: data.id });
}

const partySchema = z.object({
  groupId: z.string().uuid(),
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  partyKinds: z.array(z.enum(["customer", "supplier", "expense", "employee", "broker", "agent"])).min(1, "Select at least one account header"),
  gstin: z.string().optional(),
  stateCode: z.string().length(2).optional(),
  creditDays: z.number().int().min(0).max(3650).default(0),
  companyId: z.string().uuid().optional(),
  accountGroupId: z.string().uuid().optional(),
});

export async function createParty(
  input: z.infer<typeof partySchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const perm = assertPermission(auth.data, "masters.write");
  if (!perm.ok) return perm;

  const parsed = partySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("parties")
    .insert({
      group_id: parsed.data.groupId,
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
      party_kinds: parsed.data.partyKinds,
      gstin: parsed.data.gstin || null,
      state_code: parsed.data.stateCode || null,
      credit_days: parsed.data.creditDays,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Failed to create party");

  if (parsed.data.companyId) {
    const access = await assertCompanyAccess(parsed.data.companyId, "manage");
    if (!access.ok) return access;

    const { data: company } = await supabase
      .from("companies")
      .select("id, group_id")
      .eq("id", parsed.data.companyId)
      .maybeSingle();
    if (!company || company.group_id !== parsed.data.groupId) {
      return fail("Select a company from the same company group");
    }

    let accountGroupId = parsed.data.accountGroupId || null;
    if (!accountGroupId) {
      await insertBusyAccountGroups(supabase as never, parsed.data.companyId);
      const preferred = parsed.data.partyKinds.includes("customer")
        ? "BS-DEB"
        : parsed.data.partyKinds.includes("supplier")
          ? "BS-CRED"
          : parsed.data.partyKinds.includes("expense")
            ? "PL-IE"
            : "BS-CA";
      const { data: group } = await supabase
        .from("account_groups")
        .select("id")
        .eq("company_id", parsed.data.companyId)
        .eq("code", preferred)
        .maybeSingle();
      accountGroupId = group?.id ?? null;
    } else {
      const { data: group } = await supabase
        .from("account_groups")
        .select("id, company_id")
        .eq("id", accountGroupId)
        .maybeSingle();
      if (!group || group.company_id !== parsed.data.companyId) {
        return fail("Account head belongs to a different company");
      }
    }

    const { data: ledger, error: ledgerError } = await supabase
      .from("ledgers")
      .insert({
        company_id: parsed.data.companyId,
        account_group_id: accountGroupId,
        code: parsed.data.code.toUpperCase(),
        name: parsed.data.name,
        ledger_type: "party",
        party_id: data.id,
        is_intercompany: false,
      })
      .select("id")
      .single();
    if (ledgerError || !ledger) {
      return fail(ledgerError?.message ?? "Party saved, but ledger could not be created");
    }
    await supabase.from("party_company_links").upsert(
      {
        party_id: data.id,
        company_id: parsed.data.companyId,
        ledger_id: ledger.id,
      },
      { onConflict: "party_id,company_id" },
    );
  }

  revalidatePath("/masters/parties");
  revalidatePath("/masters/ledgers");
  return ok({ id: data.id });
}

const partyCompanyLinkSchema = z.object({ partyId: z.string().uuid(), companyId: z.string().uuid(), ledgerId: z.string().uuid(), creditLimit: z.number().nonnegative().optional() });
export async function linkPartyToCompany(input: z.infer<typeof partyCompanyLinkSchema>): Promise<ActionResult<{ ledgerId: string }>> { const auth = await requireUser(); if (!auth.ok) return auth; const parsed = partyCompanyLinkSchema.safeParse(input); if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid party link"); const access = await assertCompanyAccess(parsed.data.companyId, "manage"); if (!access.ok) return access; const supabase = await createClient(); const { data: ledger } = await supabase.from("ledgers").select("company_id,party_id,ledger_type").eq("id",parsed.data.ledgerId).maybeSingle(); if(!ledger||ledger.company_id!==parsed.data.companyId||ledger.party_id!==parsed.data.partyId||ledger.ledger_type!=="party") return fail("Select the party's ledger from the same company"); const {error}=await supabase.from("party_company_links").upsert({party_id:parsed.data.partyId,company_id:parsed.data.companyId,ledger_id:parsed.data.ledgerId,credit_limit:parsed.data.creditLimit??null},{onConflict:"party_id,company_id"}); if(error)return fail(error.message); revalidatePath("/masters/dimensions"); revalidatePath("/masters/parties"); return ok({ledgerId:parsed.data.ledgerId}); }

const costCentreSchema=z.object({companyId:z.string().uuid(),code:z.string().trim().min(1),name:z.string().trim().min(1)});
export async function createCostCentre(input:z.infer<typeof costCentreSchema>):Promise<ActionResult<{id:string}>>{const auth=await requireUser();if(!auth.ok)return auth;const parsed=costCentreSchema.safeParse(input);if(!parsed.success)return fail(parsed.error.issues[0]?.message??"Invalid cost centre");const access=await assertCompanyAccess(parsed.data.companyId,"manage");if(!access.ok)return access;const supabase=await createClient();const{data,error}=await supabase.from("cost_centres").insert({company_id:parsed.data.companyId,code:parsed.data.code.toUpperCase(),name:parsed.data.name}).select("id").single();if(error||!data)return fail(error?.message??"Could not create cost centre");revalidatePath("/masters/dimensions");return ok({id:data.id});}

const salesmanSchema=z.object({groupId:z.string().uuid(),partyId:z.string().uuid().optional(),code:z.string().trim().min(1),name:z.string().trim().min(1),roleType:z.enum(["salesman","broker"]),commissionPct:z.number().min(0).max(100).default(0)});
export async function createSalesman(input:z.infer<typeof salesmanSchema>):Promise<ActionResult<{id:string}>>{const auth=await requireUser();if(!auth.ok)return auth;const perm=assertPermission(auth.data,"masters.write");if(!perm.ok)return perm;const parsed=salesmanSchema.safeParse(input);if(!parsed.success)return fail(parsed.error.issues[0]?.message??"Invalid salesman/broker");const supabase=await createClient();const{data,error}=await supabase.from("salesmen").insert({group_id:parsed.data.groupId,party_id:parsed.data.partyId??null,code:parsed.data.code.toUpperCase(),name:parsed.data.name,role_type:parsed.data.roleType,default_commission_pct:parsed.data.commissionPct}).select("id").single();if(error||!data)return fail(error?.message??"Could not create salesman/broker");revalidatePath("/masters/dimensions");return ok({id:data.id});}

const expenseHeadSchema=z.object({companyId:z.string().uuid(),ledgerId:z.string().uuid(),code:z.string().trim().min(1),name:z.string().trim().min(1)});
export async function createExpenseHead(input:z.infer<typeof expenseHeadSchema>):Promise<ActionResult<{id:string}>>{const auth=await requireUser();if(!auth.ok)return auth;const parsed=expenseHeadSchema.safeParse(input);if(!parsed.success)return fail(parsed.error.issues[0]?.message??"Invalid expense head");const access=await assertCompanyAccess(parsed.data.companyId,"manage");if(!access.ok)return access;const supabase=await createClient();const{data:ledger}=await supabase.from("ledgers").select("company_id,account_groups(nature)").eq("id",parsed.data.ledgerId).maybeSingle();const group=ledger?.account_groups as unknown as {nature:string}|null;if(!ledger||ledger.company_id!==parsed.data.companyId)return fail("Ledger belongs to another company");if(group?.nature!=="expense")return fail("Select an expense-nature ledger");const{data,error}=await supabase.from("expense_heads").insert({company_id:parsed.data.companyId,ledger_id:parsed.data.ledgerId,code:parsed.data.code.toUpperCase(),name:parsed.data.name}).select("id").single();if(error||!data)return fail(error?.message??"Could not create expense head");revalidatePath("/masters/dimensions");revalidatePath("/masters/expense-heads");return ok({id:data.id});}

const aliasSchema = z.object({
  partyId: z.string().uuid(),
  aliasText: z.string().trim().min(1),
  confirmed: z.boolean().default(true),
});

export async function createPartyAlias(
  input: z.infer<typeof aliasSchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const perm = assertPermission(auth.data, "masters.write");
  if (!perm.ok) return perm;

  const parsed = aliasSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const normalized = parsed.data.aliasText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("party_aliases")
    .insert({
      party_id: parsed.data.partyId,
      alias_text: parsed.data.aliasText,
      normalized_alias: normalized,
      source: "manual",
      confirmed: parsed.data.confirmed,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Failed to create alias");

  revalidatePath("/masters/aliases");
  return ok({ id: data.id });
}

const fySchema = z.object({
  companyId: z.string().uuid(),
  code: z.string().trim().min(1),
  startDate: z.string(),
  endDate: z.string(),
});

export async function ensureIndianFinancialYear(
  companyId: string,
  onDate: string,
): Promise<ActionResult<{ id: string; created: boolean; code: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const access = await assertCompanyAccess(companyId, "write");
  if (!access.ok) return access;

  const fy = indianFinancialYearForDate(onDate);
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("financial_years")
    .select("id, code")
    .eq("company_id", companyId)
    .eq("code", fy.code)
    .maybeSingle();
  if (existing)
    return ok({ id: existing.id, created: false, code: existing.code });

  const { data, error } = await supabase
    .from("financial_years")
    .insert({
      company_id: companyId,
      code: fy.code,
      start_date: fy.startDate,
      end_date: fy.endDate,
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const { data: raced } = await supabase
      .from("financial_years")
      .select("id, code")
      .eq("company_id", companyId)
      .eq("code", fy.code)
      .maybeSingle();
    if (raced) return ok({ id: raced.id, created: false, code: raced.code });
  }
  if (error || !data) return fail(error?.message ?? "Could not create financial year");

  await supabase.rpc("create_monthly_periods", {
    p_financial_year_id: data.id,
  });
  revalidatePath("/masters/financial-years");
  revalidatePath("/reports");
  return ok({ id: data.id, created: true, code: fy.code });
}

export async function ensureIndianFinancialYearsForRange(
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<ActionResult<{ codes: string[] }>> {
  const years = indianFinancialYearsCovering(fromDate, toDate);
  const codes: string[] = [];
  for (const year of years) {
    const result = await ensureIndianFinancialYear(companyId, year.startDate);
    if (!result.ok) return result;
    codes.push(result.data.code);
  }
  return ok({ codes });
}

export async function createFinancialYear(
  input: z.infer<typeof fySchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = fySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const access = await assertCompanyAccess(parsed.data.companyId, "manage");
  if (!access.ok) return access;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_years")
    .insert({
      company_id: parsed.data.companyId,
      code: parsed.data.code,
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Failed to create financial year");

  await supabase.rpc("create_monthly_periods", {
    p_financial_year_id: data.id,
  });

  revalidatePath("/masters/financial-years");
  return ok({ id: data.id });
}

const groupSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
});

export async function createCompanyGroup(
  input: z.infer<typeof groupSchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!auth.data.roles.includes("admin")) return fail("Admin only");

  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_groups")
    .insert({
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Failed to create group");

  revalidatePath("/masters/companies");
  return ok({ id: data.id });
}
