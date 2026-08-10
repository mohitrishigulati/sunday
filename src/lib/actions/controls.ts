"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCompanyAccess, assertPermission, requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/types";

export async function setPeriodLock(periodId: string, locked: boolean): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const permission = assertPermission(auth.data, "periods.lock");
  if (!permission.ok) return permission;
  const parsed = z.string().uuid().safeParse(periodId);
  if (!parsed.success) return fail("Invalid period");
  const supabase = await createClient();
  const { data: period } = await supabase.from("accounting_periods").select("id, company_id").eq("id", parsed.data).maybeSingle();
  if (!period) return fail("Period not found");
  const access = await assertCompanyAccess(period.company_id, "approve");
  if (!access.ok) return access;
  const { error } = await supabase.from("accounting_periods").update({
    is_locked: locked,
    locked_at: locked ? new Date().toISOString() : null,
    locked_by: locked ? auth.data.userId : null,
  }).eq("id", parsed.data);
  if (error) return fail(error.message);
  revalidatePath("/controls");
  return ok({ id: parsed.data });
}

const reversalSchema = z.object({
  voucherId: z.string().uuid(),
  reversalDate: z.string().date(),
  narration: z.string().trim().max(500).optional(),
});

export async function reverseVoucherAction(input: z.infer<typeof reversalSchema>): Promise<ActionResult<{ voucherNumber: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const permission = assertPermission(auth.data, "vouchers.post");
  if (!permission.ok) return permission;
  const parsed = reversalSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid reversal");
  const supabase = await createClient();
  const { data: voucher } = await supabase.from("vouchers").select("company_id, status").eq("id", parsed.data.voucherId).maybeSingle();
  if (!voucher || voucher.status !== "posted") return fail("Only a posted voucher can be reversed");
  const access = await assertCompanyAccess(voucher.company_id, "approve");
  if (!access.ok) return access;
  const { data, error } = await supabase.rpc("reverse_voucher", {
    p_voucher_id: parsed.data.voucherId,
    p_reversal_date: parsed.data.reversalDate,
    p_narration: parsed.data.narration || null,
  });
  if (error) return fail(error.message);
  revalidatePath("/controls"); revalidatePath("/cash-book"); revalidatePath("/bank-book"); revalidatePath("/journals"); revalidatePath("/reports");
  return ok({ voucherNumber: (data as { voucher_number?: string } | null)?.voucher_number ?? "" });
}

const closeYearSchema=z.object({fromFinancialYearId:z.string().uuid(),toFinancialYearId:z.string().uuid(),retainedEarningsLedgerId:z.string().uuid()});
export async function closeFinancialYearAction(input:z.infer<typeof closeYearSchema>):Promise<ActionResult<{voucherNumber:string}>>{const auth=await requireUser();if(!auth.ok)return auth;const lock=assertPermission(auth.data,"periods.lock");if(!lock.ok)return lock;const parsed=closeYearSchema.safeParse(input);if(!parsed.success)return fail(parsed.error.issues[0]?.message??"Invalid financial-year close");const supabase=await createClient();const{data:fy}=await supabase.from("financial_years").select("company_id").eq("id",parsed.data.fromFinancialYearId).maybeSingle();if(!fy)return fail("Financial year not found");const access=await assertCompanyAccess(fy.company_id,"manage");if(!access.ok)return access;const{data,error}=await supabase.rpc("close_financial_year",{p_from_financial_year_id:parsed.data.fromFinancialYearId,p_to_financial_year_id:parsed.data.toFinancialYearId,p_retained_earnings_ledger_id:parsed.data.retainedEarningsLedgerId});if(error)return fail(error.message);revalidatePath("/controls");revalidatePath("/reports");return ok({voucherNumber:(data as {voucher_number?:string}|null)?.voucher_number??""});}

const closingStockSchema = z.object({ companyId:z.string().uuid(), financialYearId:z.string().uuid(), asOfDate:z.string().date(), amount:z.number().nonnegative(), narration:z.string().trim().max(500).optional() });
export async function createClosingStockDraft(input:z.infer<typeof closingStockSchema>):Promise<ActionResult<{id:string}>>{const auth=await requireUser();if(!auth.ok)return auth;const parsed=closingStockSchema.safeParse(input);if(!parsed.success)return fail(parsed.error.issues[0]?.message??"Invalid closing stock");const access=await assertCompanyAccess(parsed.data.companyId,"write");if(!access.ok)return access;const supabase=await createClient();const{data,error}=await supabase.from("closing_stock_entries").insert({company_id:parsed.data.companyId,financial_year_id:parsed.data.financialYearId,as_of_date:parsed.data.asOfDate,amount:parsed.data.amount,narration:parsed.data.narration??null,created_by:auth.data.userId,status:"draft"}).select("id").single();if(error||!data)return fail(error?.message??"Could not save closing stock draft");revalidatePath("/controls");return ok({id:data.id});}

export async function approveClosingStock(id:string):Promise<ActionResult<{id:string}>>{const auth=await requireUser();if(!auth.ok)return auth;const permission=assertPermission(auth.data,"vouchers.approve");if(!permission.ok)return permission;const parsed=z.string().uuid().safeParse(id);if(!parsed.success)return fail("Invalid closing stock");const supabase=await createClient();const{data:row}=await supabase.from("closing_stock_entries").select("company_id,status").eq("id",parsed.data).maybeSingle();if(!row||row.status!=="draft")return fail("Only a closing stock draft can be approved");const access=await assertCompanyAccess(row.company_id,"approve");if(!access.ok)return access;const{error}=await supabase.from("closing_stock_entries").update({status:"approved"}).eq("id",parsed.data);if(error)return fail(error.message);revalidatePath("/controls");revalidatePath("/reports");return ok({id:parsed.data});}
