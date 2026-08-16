"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCompanyAccess, assertPermission, requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/types";
/** Money stays a decimal string end to end; see business-documents.ts. */
const decimalAmount=z.string().trim().regex(/^\d{1,14}(\.\d{1,4})?$/,"Amount must be a number with at most 4 decimal places").refine(v=>Number.parseFloat(v)>0||/[1-9]/.test(v),"Amount must be greater than zero");

const schema=z.object({fromCompanyId:z.string().uuid(),toCompanyId:z.string().uuid(),fromFinancialYearId:z.string().uuid(),toFinancialYearId:z.string().uuid(),fromAssetLedgerId:z.string().uuid(),fromIntercompanyLedgerId:z.string().uuid(),toAssetLedgerId:z.string().uuid(),toIntercompanyLedgerId:z.string().uuid(),transferDate:z.string().date(),amount:decimalAmount,reference:z.string().trim().optional(),narration:z.string().trim().optional()}).refine(v=>v.fromCompanyId!==v.toCompanyId,"Companies must be different");
/**
 * The transfer row, both draft legs, their lines and the linking update all run
 * inside create_intercompany_transfer. Previously these were six statements with
 * manual compensating deletes: a failure on the receiving company could leave
 * the paying company holding a voucher with no counterpart, and the transfer row
 * pointing at nothing.
 */
export async function createIntercompanyTransfer(input:z.infer<typeof schema>):Promise<ActionResult<{id:string;fromVoucherId:string;toVoucherId:string}>>{
  const auth=await requireUser();if(!auth.ok)return auth;
  const perm=assertPermission(auth.data,"vouchers.draft");if(!perm.ok)return perm;
  const parsed=schema.safeParse(input);if(!parsed.success)return fail(parsed.error.issues[0]?.message??"Invalid transfer");
  const d=parsed.data;
  const a=await assertCompanyAccess(d.fromCompanyId,"write");if(!a.ok)return a;
  const b=await assertCompanyAccess(d.toCompanyId,"write");if(!b.ok)return b;
  const supabase=await createClient();
  const{data,error}=await supabase.rpc("create_intercompany_transfer",{p_payload:{
    from_company_id:d.fromCompanyId,
    to_company_id:d.toCompanyId,
    from_financial_year_id:d.fromFinancialYearId,
    to_financial_year_id:d.toFinancialYearId,
    from_asset_ledger_id:d.fromAssetLedgerId,
    from_intercompany_ledger_id:d.fromIntercompanyLedgerId,
    to_asset_ledger_id:d.toAssetLedgerId,
    to_intercompany_ledger_id:d.toIntercompanyLedgerId,
    transfer_date:d.transferDate,
    amount:d.amount,
    utr_reference:d.reference??null,
    narration:d.narration??null,
  }});
  if(error)return fail(error.message);
  const transfer=data as{id?:string;from_voucher_id?:string;to_voucher_id?:string}|null;
  if(!transfer?.id||!transfer.from_voucher_id||!transfer.to_voucher_id)return fail("Could not create transfer");
  revalidatePath("/intercompany");revalidatePath("/reports");
  return ok({id:transfer.id,fromVoucherId:transfer.from_voucher_id,toVoucherId:transfer.to_voucher_id});
}
export async function finalizeIntercompanyTransfer(id:string):Promise<ActionResult<{id:string}>>{const auth=await requireUser();if(!auth.ok)return auth;const parsed=z.string().uuid().safeParse(id);if(!parsed.success)return fail("Invalid transfer");const supabase=await createClient();const{data:t}=await supabase.from("intercompany_transfers").select("from_company_id,to_company_id,from_voucher_id,to_voucher_id,vouchers_from:from_voucher_id(status),vouchers_to:to_voucher_id(status)").eq("id",parsed.data).maybeSingle();if(!t)return fail("Transfer not found");const a=await assertCompanyAccess(t.from_company_id,"approve");if(!a.ok)return a;const b=await assertCompanyAccess(t.to_company_id,"approve");if(!b.ok)return b;if((t.vouchers_from as unknown as {status:string}|null)?.status!=="posted"||(t.vouchers_to as unknown as {status:string}|null)?.status!=="posted")return fail("Both company vouchers must be posted before matching");const{error}=await supabase.from("intercompany_transfers").update({match_status:"matched",matched_at:new Date().toISOString(),matched_by:auth.data.userId}).eq("id",parsed.data);if(error)return fail(error.message);revalidatePath("/intercompany");return ok({id:parsed.data});}
