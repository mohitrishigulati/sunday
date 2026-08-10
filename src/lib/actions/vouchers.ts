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

const openingBalanceSchema = z.object({
  companyId: z.string().uuid(),
  financialYearId: z.string().uuid(),
  voucherDate: z.string(),
  narration: z.string().optional(),
  lines: z
    .array(
      z.object({
        ledgerId: z.string().uuid(),
        locationId: z.string().uuid().optional(),
        partyId: z.string().uuid().optional(),
        debitAmount: z.number().nonnegative(),
        creditAmount: z.number().nonnegative(),
        narration: z.string().optional(),
      }),
    )
    .min(2),
  postImmediately: z.boolean().default(false),
});

export async function createOpeningBalanceVoucher(
  input: z.infer<typeof openingBalanceSchema>,
): Promise<ActionResult<{ id: string; voucherNumber: string | null }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const draftPerm = assertPermission(auth.data, "vouchers.draft");
  if (!draftPerm.ok) return draftPerm;

  const parsed = openingBalanceSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const access = await assertCompanyAccess(parsed.data.companyId, "write");
  if (!access.ok) return access;

  const totalDr = parsed.data.lines.reduce((s, l) => s + l.debitAmount, 0);
  const totalCr = parsed.data.lines.reduce((s, l) => s + l.creditAmount, 0);

  // Draft may be saved unbalanced. Balance is enforced only at post time (DB + below).
  for (const line of parsed.data.lines) {
    if (
      (line.debitAmount > 0 && line.creditAmount > 0) ||
      (line.debitAmount === 0 && line.creditAmount === 0)
    ) {
      return fail("Each line must be either debit or credit");
    }
  }

  // Everything the post path needs is checked before any row is written, so a
  // rejected request never leaves an orphan draft behind.
  if (parsed.data.postImmediately) {
    if (Number(totalDr.toFixed(4)) !== Number(totalCr.toFixed(4))) {
      return fail("Cannot post unbalanced voucher (debits must equal credits)");
    }
    if (totalDr <= 0) return fail("Cannot post voucher with zero totals");

    const approvePerm = assertPermission(auth.data, "vouchers.approve");
    if (!approvePerm.ok) return approvePerm;

    const postPerm = assertPermission(auth.data, "vouchers.post");
    if (!postPerm.ok) return postPerm;

    const approveAccess = await assertCompanyAccess(parsed.data.companyId, "approve");
    if (!approveAccess.ok) return approveAccess;

    // Separation of duties is enforced in the DB (approve_voucher). Reject here
    // as well, so the maker is not told to save a draft they cannot then post.
    if (
      !auth.data.roles.includes("admin") &&
      !auth.data.permissions["vouchers.self_approve"]
    ) {
      return fail(
        "You cannot approve your own voucher. Save it as a draft for an approver instead.",
      );
    }
  }

  const supabase = await createClient();

  // Ensure system Opening Balance Offset ledger exists for genuine TB tally
  await supabase.rpc("ensure_opening_balance_offset_ledger", {
    p_company_id: parsed.data.companyId,
  });

  const { data: vt, error: vtError } = await supabase
    .from("voucher_types")
    .select("id")
    .eq("company_id", parsed.data.companyId)
    .eq("code", "OB")
    .maybeSingle();

  if (vtError || !vt) {
    return fail("Opening balance voucher type not found. Seed company voucher types first.");
  }

  const draftRef = `DRAFT-${crypto.randomUUID().slice(0, 8)}`;

  const { data: voucher, error: voucherError } = await supabase
    .from("vouchers")
    .insert({
      company_id: parsed.data.companyId,
      financial_year_id: parsed.data.financialYearId,
      voucher_type_id: vt.id,
      voucher_date: parsed.data.voucherDate,
      draft_ref: draftRef,
      status: "draft",
      narration: parsed.data.narration || "Opening balances",
      created_by: auth.data.userId,
    })
    .select("id")
    .single();

  if (voucherError || !voucher) {
    return fail(voucherError?.message ?? "Failed to create voucher");
  }

  const lineRows = parsed.data.lines.map((line, index) => ({
    voucher_id: voucher.id,
    line_no: index + 1,
    company_id: parsed.data.companyId,
    location_id: line.locationId || null,
    financial_year_id: parsed.data.financialYearId,
    ledger_id: line.ledgerId,
    party_id: line.partyId || null,
    debit_amount: line.debitAmount,
    credit_amount: line.creditAmount,
    narration: line.narration || null,
  }));

  const { error: linesError } = await supabase.from("voucher_lines").insert(lineRows);
  if (linesError) {
    await supabase.from("vouchers").delete().eq("id", voucher.id);
    return fail(linesError.message);
  }

  let voucherNumber: string | null = null;

  if (parsed.data.postImmediately) {
    // Approval required before post. Maker≠approver enforced in DB (admin exempt).
    const { error: approveError } = await supabase.rpc("approve_voucher", {
      p_voucher_id: voucher.id,
    });
    if (approveError) {
      await supabase.from("vouchers").delete().eq("id", voucher.id);
      return fail(approveError.message);
    }

    const { data: posted, error: postError } = await supabase.rpc("post_voucher", {
      p_voucher_id: voucher.id,
    });

    // An approved-but-unpostable voucher is left in place deliberately: it is a
    // real record awaiting a fix, and it can no longer be deleted under RLS.
    if (postError) return fail(postError.message);
    voucherNumber = (posted as { voucher_number?: string } | null)?.voucher_number ?? null;
  }

  revalidatePath("/opening-balances");
  return ok({ id: voucher.id, voucherNumber });
}

export async function approveVoucherAction(
  voucherId: string,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const approvePerm = assertPermission(auth.data, "vouchers.approve");
  if (!approvePerm.ok) return approvePerm;

  const supabase = await createClient();
  const { data: voucher, error: fetchError } = await supabase
    .from("vouchers")
    .select("id, company_id")
    .eq("id", voucherId)
    .maybeSingle();

  if (fetchError || !voucher) return fail("Voucher not found");

  const access = await assertCompanyAccess(voucher.company_id, "approve");
  if (!access.ok) return access;

  const { data, error } = await supabase.rpc("approve_voucher", {
    p_voucher_id: voucherId,
  });

  if (error) return fail(error.message);

  revalidatePath("/opening-balances");
  revalidatePath("/cash-book");
  revalidatePath("/bank-book");
  revalidatePath("/journals");
  revalidatePath("/business");
  revalidatePath("/intercompany");
  return ok({ id: (data as { id?: string } | null)?.id ?? voucherId });
}

export async function postVoucherAction(
  voucherId: string,
): Promise<ActionResult<{ voucherNumber: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const postPerm = assertPermission(auth.data, "vouchers.post");
  if (!postPerm.ok) return postPerm;

  const supabase = await createClient();
  const { data: voucher, error: fetchError } = await supabase
    .from("vouchers")
    .select("id, company_id, status")
    .eq("id", voucherId)
    .maybeSingle();

  if (fetchError || !voucher) return fail("Voucher not found");

  if (voucher.status !== "approved" && voucher.status !== "posted") {
    return fail(`Only approved vouchers can be posted (status=${voucher.status})`);
  }

  const access = await assertCompanyAccess(voucher.company_id, "approve");
  if (!access.ok) return access;

  const { data: posted, error: postError } = await supabase.rpc("post_voucher", {
    p_voucher_id: voucherId,
  });

  if (postError) return fail(postError.message);

  const voucherNumber =
    (posted as { voucher_number?: string } | null)?.voucher_number ?? "";

  revalidatePath("/opening-balances");
  revalidatePath("/cash-book");
  revalidatePath("/bank-book");
  revalidatePath("/journals");
  revalidatePath("/business");
  revalidatePath("/intercompany");
  return ok({ voucherNumber });
}
