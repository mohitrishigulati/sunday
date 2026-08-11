"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCompanyAccess, assertPermission, requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/types";
import { statementBalanceErrorMessage, validateStatementBalances } from "@/lib/bank-statement-validation";

const rowSchema = z.object({ txnDate: z.string().date(), valueDate: z.string().date().optional(), description: z.string().max(1000).optional(), reference: z.string().max(200).optional(), transactionType: z.string().trim().max(100).optional(), debitAmount: z.number().nonnegative(), creditAmount: z.number().nonnegative(), balanceAfter: z.number().optional() }).refine((row) => (row.debitAmount > 0) !== (row.creditAmount > 0), "Each transaction must be debit or credit");
const attachmentSchema = z.object({ storagePath: z.string().min(1).max(1000), fileName: z.string().min(1).max(255), mimeType: z.string().max(255).optional(), fileHash: z.string().length(64) });
const importSchema = z.object({ companyId: z.string().uuid(), bankAccountId: z.string().uuid(), fileName: z.string().min(1).max(255), sourceFormat: z.enum(["csv", "xlsx", "pdf"]), openingBalance: z.number().finite().optional(), closingBalance: z.number().finite({ message: "Statement closing balance is required" }), rows: z.array(rowSchema).min(1).max(10000), attachment: attachmentSchema.optional() });

function moneyUnits(value: number): number { return Math.round(value * 10000); }

async function sha256(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

async function canonicalLineFingerprint(bankAccountId: string, row: { reference?: string | null; txnDate: string; debitAmount: number; creditAmount: number }) {
  const reference = (row.reference ?? "").toUpperCase().replace(/\s/g, "");
  const amount = Math.max(row.debitAmount, row.creditAmount).toFixed(4);
  const direction = row.debitAmount > 0 ? "DR" : "CR";
  return sha256(`${bankAccountId}|${reference}|${row.txnDate}|${amount}|${direction}`);
}

export async function importBankStatement(input: z.infer<typeof importSchema>): Promise<ActionResult<{ id: string; imported: number; duplicatesQueued: number; balanceMismatch: boolean }>> {
  const auth = await requireUser(); if (!auth.ok) return auth;
  const permission = assertPermission(auth.data, "bank.import"); if (!permission.ok) return permission;
  const parsed = importSchema.safeParse(input); if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid statement");
  const access = await assertCompanyAccess(parsed.data.companyId, "write"); if (!access.ok) return access;
  const supabase = await createClient();
  const { data: account } = await supabase.from("bank_accounts").select("company_id").eq("id", parsed.data.bankAccountId).eq("is_active", true).maybeSingle();
  if (!account || account.company_id !== parsed.data.companyId) return fail("Bank account does not belong to selected company");
  const balanceValidation = validateStatementBalances(parsed.data.rows, parsed.data.openingBalance);
  if (!balanceValidation.valid) {
    return fail(statementBalanceErrorMessage(balanceValidation));
  }
  const detectedClosing = balanceValidation.detectedClosing;
  if (detectedClosing === undefined) return fail("Statement closing balance could not be detected from the uploaded rows");
  if (moneyUnits(detectedClosing) !== moneyUnits(parsed.data.closingBalance)) {
    return fail(`Manual closing balance does not match statement. Enter ${detectedClosing.toFixed(4)}`);
  }
  const canonical = JSON.stringify(parsed.data.rows);
  const fileHash = await sha256(`${parsed.data.bankAccountId}|${canonical}`);
  const { data: existing } = await supabase.from("bank_statement_imports").select("id").eq("bank_account_id", parsed.data.bankAccountId).eq("file_hash", fileHash).maybeSingle();
  if (existing) return fail("This statement file has already been imported");
  const calculatedClosing = balanceValidation.detectedOpening === undefined ? undefined : Number((balanceValidation.detectedOpening + parsed.data.rows.reduce((sum, row) => sum + row.creditAmount - row.debitAmount, 0)).toFixed(4));
  const mismatch = calculatedClosing === undefined || moneyUnits(calculatedClosing) !== moneyUnits(parsed.data.closingBalance);
  let attachmentId: string | null = null;
  if (parsed.data.attachment) {
    if (!parsed.data.attachment.storagePath.startsWith(`${parsed.data.companyId}/`)) return fail("Attachment path does not match the selected company");
    const { data: attachment, error: attachmentError } = await supabase.from("attachments").insert({ company_id: parsed.data.companyId, storage_path: parsed.data.attachment.storagePath, file_name: parsed.data.attachment.fileName, mime_type: parsed.data.attachment.mimeType ?? null, file_hash: parsed.data.attachment.fileHash, uploaded_by: auth.data.userId }).select("id").single();
    if (attachmentError || !attachment) return fail(attachmentError?.message ?? "Could not register statement attachment");
    attachmentId = attachment.id;
  }
  const { data: statement, error } = await supabase.from("bank_statement_imports").insert({ company_id: parsed.data.companyId, bank_account_id: parsed.data.bankAccountId, source_format: parsed.data.sourceFormat, parser_key: "generic-column-map-v1", file_hash: fileHash, file_name: parsed.data.fileName, statement_from: parsed.data.rows.map((row) => row.txnDate).sort()[0], statement_to: parsed.data.rows.map((row) => row.txnDate).sort().at(-1), opening_balance: balanceValidation.detectedOpening ?? parsed.data.openingBalance ?? null, closing_balance: parsed.data.closingBalance, calculated_closing: calculatedClosing ?? null, balance_mismatch: mismatch, imported_by: auth.data.userId, attachment_id: attachmentId }).select("id").single();
  if (error || !statement) { if (attachmentId) await supabase.from("attachments").delete().eq("id", attachmentId); return fail(error?.message ?? "Could not create statement import"); }
  const lineRows = await Promise.all(parsed.data.rows.map(async (row, index) => ({ import_id: statement.id, bank_account_id: parsed.data.bankAccountId, statement_sequence: index + 1, txn_date: row.txnDate, value_date: row.valueDate ?? null, description: row.description ?? null, reference: row.reference ?? null, transaction_type: row.transactionType || (row.debitAmount > 0 ? "Debit" : "Credit"), debit_amount: row.debitAmount, credit_amount: row.creditAmount, balance_after: row.balanceAfter ?? null, raw_payload: { ...row, statementSequence: index + 1 }, fingerprint: await canonicalLineFingerprint(parsed.data.bankAccountId, row) })));
  // Preserve every raw row. Canonical collisions are retained and routed to
  // the database duplicate-exception queue instead of being silently dropped.
  const { error: lineError } = await supabase.from("bank_statement_lines").insert(lineRows);
  if (lineError) { await supabase.from("bank_statement_imports").delete().eq("id", statement.id); if (attachmentId) await supabase.from("attachments").delete().eq("id", attachmentId); return fail(lineError.message); }
  const { count: duplicatesQueued } = await supabase.from("bank_duplicate_exceptions").select("id", { count: "exact", head: true }).eq("import_id", statement.id);
  await supabase.rpc("suggest_bank_statement_parties", { p_import_id: statement.id });
  revalidatePath("/bank-import"); revalidatePath("/dashboard"); return ok({ id: statement.id, imported: lineRows.length, duplicatesQueued: duplicatesQueued ?? 0, balanceMismatch: mismatch });
}

export async function setBankLineMatch(lineId: string, voucherId?: string, ignore = false): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser(); if (!auth.ok) return auth;
  const permission = assertPermission(auth.data, "bank.import"); if (!permission.ok) return permission;
  const id = z.string().uuid().safeParse(lineId); if (!id.success) return fail("Invalid bank line");
  const supabase = await createClient();
  const { data: line } = await supabase.from("bank_statement_lines").select("id, bank_accounts!bank_statement_lines_bank_account_id_fkey(company_id)").eq("id", id.data).maybeSingle();
  const companyId = (line?.bank_accounts as unknown as { company_id: string } | null)?.company_id;
  if (!line || !companyId) return fail("Bank line not found");
  const access = await assertCompanyAccess(companyId, "write"); if (!access.ok) return access;
  const { error } = await supabase.rpc("match_bank_statement_line", { p_line_id: id.data, p_voucher_id: voucherId ?? null, p_ignore: ignore });
  if (error) return fail(error.message); revalidatePath("/bank-import"); return ok({ id: id.data });
}

export async function setBankLineCounterparty(lineId: string, selection?: string): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser(); if (!auth.ok) return auth;
  const permission = assertPermission(auth.data, "bank.import"); if (!permission.ok) return permission;
  const parsedLineId = z.string().uuid().safeParse(lineId); if (!parsedLineId.success) return fail("Invalid bank line");
  const [kind, rawId] = selection ? selection.split(":", 2) : ["", ""];
  if (selection && !["party", "bank"].includes(kind)) return fail("Invalid counterparty type");
  const parsedTargetId = rawId ? z.string().uuid().safeParse(rawId) : null;
  if (selection && !parsedTargetId?.success) return fail("Invalid counterparty");
  const supabase = await createClient();
  const { data: line } = await supabase.from("bank_statement_lines").select("id, bank_account_id, bank_accounts!bank_statement_lines_bank_account_id_fkey(company_id, companies(group_id))").eq("id", parsedLineId.data).maybeSingle();
  const account = line?.bank_accounts as unknown as { company_id: string; companies: { group_id: string } | null } | null;
  if (!line || !account?.company_id || !account.companies?.group_id) return fail("Bank line not found");
  const access = await assertCompanyAccess(account.company_id, "write"); if (!access.ok) return access;
  if (kind === "party" && parsedTargetId?.success) {
    const { data: party } = await supabase.from("parties").select("group_id,is_active").eq("id", parsedTargetId.data).maybeSingle();
    if (!party?.is_active || party.group_id !== account.companies.group_id) return fail("Party does not belong to this company group");
  }
  if (kind === "bank" && parsedTargetId?.success) {
    if (parsedTargetId.data === line.bank_account_id) return fail("Source bank account cannot be selected as counterparty");
    const { data: targetBank } = await supabase.from("bank_accounts").select("company_id,is_active,companies(group_id)").eq("id", parsedTargetId.data).maybeSingle();
    const targetCompany = targetBank?.companies as unknown as { group_id: string } | null;
    if (!targetBank?.is_active || targetCompany?.group_id !== account.companies.group_id) return fail("Bank account does not belong to this company group");
  }
  const { error } = await supabase.from("bank_statement_lines").update({
    suggested_party_id: kind === "party" && parsedTargetId?.success ? parsedTargetId.data : null,
    counterparty_bank_account_id: kind === "bank" && parsedTargetId?.success ? parsedTargetId.data : null,
    ambiguity_note: null,
  }).eq("id", parsedLineId.data);
  if (error) return fail(error.message);
  revalidatePath("/reports"); revalidatePath("/bank-import"); return ok({ id: parsedLineId.data });
}

const reconciliationSchema = z.object({ bankAccountId: z.string().uuid(), asOfDate: z.string().date(), statementClosing: z.number() });
export async function createBankReconciliation(input: z.infer<typeof reconciliationSchema>): Promise<ActionResult<{ id: string; difference: number }>> {
  const auth = await requireUser(); if (!auth.ok) return auth;
  const permission = assertPermission(auth.data, "bank.import"); if (!permission.ok) return permission;
  const parsed = reconciliationSchema.safeParse(input); if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid reconciliation");
  const supabase = await createClient(); const { data: account } = await supabase.from("bank_accounts").select("company_id, ledger_id").eq("id", parsed.data.bankAccountId).maybeSingle(); if (!account) return fail("Bank account not found");
  const access = await assertCompanyAccess(account.company_id, "write"); if (!access.ok) return access;
  const { data: postings } = await supabase.from("ledger_postings").select("debit_amount, credit_amount").eq("ledger_id", account.ledger_id).lte("voucher_date", parsed.data.asOfDate);
  const bookClosing = Number((postings ?? []).reduce((sum, row) => sum + Number(row.debit_amount) - Number(row.credit_amount), 0).toFixed(4)); const difference = Number((parsed.data.statementClosing - bookClosing).toFixed(4));
  const { data, error } = await supabase.from("bank_reconciliations").insert({ bank_account_id: parsed.data.bankAccountId, as_of_date: parsed.data.asOfDate, statement_closing: parsed.data.statementClosing, book_closing: bookClosing, status: difference === 0 ? "completed" : "open", created_by: auth.data.userId }).select("id").single();
  if (error || !data) return fail(error?.message ?? "Could not save reconciliation"); revalidatePath("/bank-import"); return ok({ id: data.id, difference });
}
