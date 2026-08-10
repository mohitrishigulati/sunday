"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCompanyAccess, assertPermission, requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/types";

const lineSchema = z.object({
  ledgerId: z.string().uuid(),
  debitAmount: z.number().nonnegative(),
  creditAmount: z.number().nonnegative(),
  partyId: z.string().uuid().optional(),
  narration: z.string().trim().max(500).optional(),
});

const journalSchema = z.object({
  companyId: z.string().uuid(),
  financialYearId: z.string().uuid(),
  voucherDate: z.string().date(),
  narration: z.string().trim().min(1).max(500),
  lines: z.array(lineSchema).min(2),
});

async function createDraftVoucher(input: {
  companyId: string;
  financialYearId: string;
  voucherDate: string;
  narration: string;
  voucherTypeCode: string;
  locationId?: string;
  partyId?: string;
  lines: Array<z.infer<typeof lineSchema>>;
}): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const permission = assertPermission(auth.data, "vouchers.draft");
  if (!permission.ok) return permission;
  const access = await assertCompanyAccess(input.companyId, "write");
  if (!access.ok) return access;

  const totalDebit = input.lines.reduce((sum, line) => sum + line.debitAmount, 0);
  const totalCredit = input.lines.reduce((sum, line) => sum + line.creditAmount, 0);
  if (totalDebit <= 0 || Number(totalDebit.toFixed(4)) !== Number(totalCredit.toFixed(4))) {
    return fail("Voucher debit and credit totals must be equal and greater than zero");
  }
  if (input.lines.some((line) => (line.debitAmount > 0) === (line.creditAmount > 0))) {
    return fail("Every line must contain either a debit or a credit amount");
  }

  const supabase = await createClient();
  const [{ data: financialYear }, { data: voucherType }, { data: ledgers }] = await Promise.all([
    supabase.from("financial_years").select("id").eq("id", input.financialYearId).eq("company_id", input.companyId).maybeSingle(),
    supabase.from("voucher_types").select("id").eq("company_id", input.companyId).eq("code", input.voucherTypeCode).maybeSingle(),
    supabase.from("ledgers").select("id").eq("company_id", input.companyId).in("id", [...new Set(input.lines.map((line) => line.ledgerId))]).eq("is_active", true).is("deleted_at", null),
  ]);
  if (!financialYear) return fail("Financial year does not belong to the selected company");
  if (!voucherType) return fail(`${input.voucherTypeCode} voucher type is not configured`);
  if ((ledgers ?? []).length !== new Set(input.lines.map((line) => line.ledgerId)).size) {
    return fail("One or more ledgers are invalid for the selected company");
  }

  const { data: voucher, error: voucherError } = await supabase
    .from("vouchers")
    .insert({
      company_id: input.companyId,
      location_id: input.locationId ?? null,
      financial_year_id: input.financialYearId,
      voucher_type_id: voucherType.id,
      voucher_date: input.voucherDate,
      draft_ref: `DRAFT-${crypto.randomUUID().slice(0, 8)}`,
      party_id: input.partyId ?? null,
      narration: input.narration,
      created_by: auth.data.userId,
    })
    .select("id")
    .single();
  if (voucherError || !voucher) return fail(voucherError?.message ?? "Could not create voucher");

  const { error: lineError } = await supabase.from("voucher_lines").insert(
    input.lines.map((line, index) => ({
      voucher_id: voucher.id,
      line_no: index + 1,
      company_id: input.companyId,
      location_id: input.locationId ?? null,
      financial_year_id: input.financialYearId,
      ledger_id: line.ledgerId,
      party_id: line.partyId ?? null,
      debit_amount: line.debitAmount,
      credit_amount: line.creditAmount,
      narration: line.narration || input.narration,
    })),
  );
  if (lineError) {
    await supabase.from("vouchers").delete().eq("id", voucher.id);
    return fail(lineError.message);
  }
  return ok({ id: voucher.id });
}

export async function createJournalEntry(
  input: z.infer<typeof journalSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = journalSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid journal entry");
  const result = await createDraftVoucher({ ...parsed.data, voucherTypeCode: "JV" });
  if (result.ok) revalidatePath("/journals");
  return result;
}

const bankEntrySchema = z.object({
  companyId: z.string().uuid(),
  financialYearId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  voucherDate: z.string().date(),
  entryKind: z.enum(["receipt", "payment"]),
  counterpartyLedgerId: z.string().uuid(),
  partyId: z.string().uuid().optional(),
  amount: z.number().positive(),
  reference: z.string().trim().max(100).optional(),
  narration: z.string().trim().min(1).max(500),
});

export async function createBankBookEntry(
  input: z.infer<typeof bankEntrySchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = bankEntrySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid bank entry");
  const supabase = await createClient();
  const [{ data: account }, { data: counterparty }] = await Promise.all([supabase
    .from("bank_accounts")
    .select("company_id, ledger_id")
    .eq("id", parsed.data.bankAccountId)
    .eq("is_active", true)
    .maybeSingle(), supabase.from("ledgers").select("company_id,party_id").eq("id", parsed.data.counterpartyLedgerId).maybeSingle()]);
  if (!account || account.company_id !== parsed.data.companyId) {
    return fail("Bank account does not belong to the selected company");
  }
  if (account.ledger_id === parsed.data.counterpartyLedgerId) {
    return fail("Select a counterparty ledger different from the bank ledger");
  }
  if (!counterparty || counterparty.company_id !== parsed.data.companyId) return fail("Counterparty ledger does not belong to the selected company");
  const partyId = parsed.data.partyId ?? counterparty.party_id ?? undefined;
  const bankIsDebit = parsed.data.entryKind === "receipt";
  const result = await createDraftVoucher({
    companyId: parsed.data.companyId,
    financialYearId: parsed.data.financialYearId,
    voucherDate: parsed.data.voucherDate,
    narration: parsed.data.narration,
    voucherTypeCode: bankIsDebit ? "BNK-R" : "BNK-P",
    partyId,
    lines: [
      {
        ledgerId: account.ledger_id,
        debitAmount: bankIsDebit ? parsed.data.amount : 0,
        creditAmount: bankIsDebit ? 0 : parsed.data.amount,
        narration: parsed.data.reference
          ? `${parsed.data.narration} (${parsed.data.reference})`
          : parsed.data.narration,
      },
      {
        ledgerId: parsed.data.counterpartyLedgerId,
        partyId,
        debitAmount: bankIsDebit ? 0 : parsed.data.amount,
        creditAmount: bankIsDebit ? parsed.data.amount : 0,
        narration: parsed.data.narration,
      },
    ],
  });
  if (result.ok) revalidatePath("/bank-book");
  return result;
}
