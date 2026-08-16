"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCompanyAccess, assertPermission, requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/types";

/**
 * Money and quantities travel as decimal strings from the form to the RPC and
 * are never parsed into a JavaScript number on the way. `Number("0.1")` is
 * already lossy, so converting even once — to validate, to sum, to re-serialise
 * — would defeat the numeric(18,4) arithmetic on the database side.
 */
const decimal = (opts: { min?: string; max?: string; allowNegative?: boolean } = {}) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,14}(\.\d{1,4})?$/, "Must be a number with at most 4 decimal places")
    .refine((v) => opts.allowNegative || !v.startsWith("-"), "Cannot be negative")
    .refine(
      (v) => opts.min === undefined || compareDecimal(v, opts.min) >= 0,
      `Must be at least ${opts.min}`,
    )
    .refine(
      (v) => opts.max === undefined || compareDecimal(v, opts.max) <= 0,
      `Must be at most ${opts.max}`,
    );

/** Compares two decimal strings without going through a float. */
function compareDecimal(a: string, b: string): number {
  const scale = (s: string) => {
    const negative = s.startsWith("-");
    const [whole, fraction = ""] = (negative ? s.slice(1) : s).split(".");
    return { negative, digits: `${whole}${fraction.padEnd(4, "0")}`.replace(/^0+(?=\d)/, "") };
  };
  const x = scale(a);
  const y = scale(b);
  if (x.negative !== y.negative) return x.negative ? -1 : 1;
  const width = Math.max(x.digits.length, y.digits.length);
  const cmp = x.digits.padStart(width, "0").localeCompare(y.digits.padStart(width, "0"));
  return x.negative ? -cmp : cmp;
}

const isPositive = (v: string) => compareDecimal(v, "0") > 0;

const itemSchema = z.object({ description: z.string().trim().min(1), hsnSac: z.string().trim().optional(), quantity: decimal().refine(isPositive, "Quantity must be greater than zero"), unit: z.string().trim().min(1), rate: decimal(), discountAmount: decimal().default("0"), gstRate: decimal({ min: "0", max: "100" }), tradeLedgerId: z.string().uuid(), costCentreId: z.string().uuid().optional(), salesmanId: z.string().uuid().optional() });
const attachmentSchema = z.object({ storagePath: z.string().min(1).max(1000), fileName: z.string().min(1).max(255), mimeType: z.string().max(255).optional(), fileHash: z.string().length(64) });
const documentSchema = z.object({ companyId: z.string().uuid(), financialYearId: z.string().uuid(), documentType: z.enum(["sale", "purchase", "credit_note", "debit_note"]), originalDocumentId: z.string().uuid().optional(), documentNumber: z.string().trim().min(1).max(100), documentDate: z.string().date(), dueDate: z.string().date(), partyId: z.string().uuid(), partyLedgerId: z.string().uuid(), placeOfSupply: z.string().length(2).optional(), isInterstate: z.boolean(), cgstLedgerId: z.string().uuid().optional(), sgstLedgerId: z.string().uuid().optional(), igstLedgerId: z.string().uuid().optional(), tdsLedgerId: z.string().uuid().optional(), roundOffLedgerId: z.string().uuid().optional(), tdsSection: z.string().trim().optional(), tdsRate: decimal({ min: "0", max: "100" }).default("0"), roundOff: decimal({ min: "-10", max: "10", allowNegative: true }).default("0"), ewayBillNo: z.string().trim().optional(), narration: z.string().trim().optional(), attachment: attachmentSchema.optional(), items: z.array(itemSchema).min(1).max(200) });

export async function createBusinessDocument(input: z.infer<typeof documentSchema>): Promise<ActionResult<{ id: string; voucherId: string }>> {
  const auth = await requireUser(); if (!auth.ok) return auth; const permission = assertPermission(auth.data, "vouchers.draft"); if (!permission.ok) return permission;
  const parsed = documentSchema.safeParse(input); if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid document"); const data = parsed.data;
  const access = await assertCompanyAccess(data.companyId, "write"); if (!access.ok) return access;
  const supabase = await createClient();

  // All money arithmetic, ledger validation and the five inserts happen inside
  // create_business_document. It is one transaction, so a failure anywhere rolls
  // the whole invoice back instead of leaving an orphan voucher, and every
  // amount is computed in numeric(18,4) rather than JavaScript doubles.
  const { data: document, error } = await supabase.rpc("create_business_document", {
    p_payload: {
      company_id: data.companyId,
      financial_year_id: data.financialYearId,
      document_type: data.documentType,
      // A credit note adjusts a sale, a debit note a purchase. The database
      // enforces that pairing and caps the notes at the invoice value.
      original_document_id: data.originalDocumentId ?? null,
      document_number: data.documentNumber,
      document_date: data.documentDate,
      due_date: data.dueDate,
      party_id: data.partyId,
      party_ledger_id: data.partyLedgerId,
      place_of_supply: data.placeOfSupply ?? null,
      is_interstate: data.isInterstate,
      cgst_ledger_id: data.cgstLedgerId ?? null,
      sgst_ledger_id: data.sgstLedgerId ?? null,
      igst_ledger_id: data.igstLedgerId ?? null,
      tds_ledger_id: data.tdsLedgerId ?? null,
      round_off_ledger_id: data.roundOffLedgerId ?? null,
      tds_section: data.tdsSection ?? null,
      tds_rate: data.tdsRate,
      round_off: data.roundOff,
      eway_bill_no: data.ewayBillNo ?? null,
      narration: data.narration ?? null,
      attachment: data.attachment
        ? {
            storage_path: data.attachment.storagePath,
            file_name: data.attachment.fileName,
            mime_type: data.attachment.mimeType ?? null,
            file_hash: data.attachment.fileHash,
          }
        : null,
      items: data.items.map((item) => ({
        description: item.description,
        hsn_sac: item.hsnSac ?? null,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        discount_amount: item.discountAmount,
        gst_rate: item.gstRate,
        trade_ledger_id: item.tradeLedgerId,
        cost_centre_id: item.costCentreId ?? null,
        salesman_id: item.salesmanId ?? null,
      })),
    },
  });

  if (error) return fail(error.message);
  const created = document as { id?: string; voucher_id?: string } | null;
  if (!created?.id || !created.voucher_id) return fail("Could not create invoice");

  revalidatePath("/business"); revalidatePath("/reports"); return ok({ id: created.id, voucherId: created.voucher_id });
}

const allocationSchema = z.object({ documentId: z.string().uuid(), settlementVoucherLineId: z.string().uuid(), amount: decimal().refine(isPositive, "Amount must be greater than zero"), allocationDate: z.string().date() });

/**
 * The outstanding check and the insert run inside allocate_bill_settlement, so
 * they share one transaction and one lock on the invoice. Reading the sum here
 * and inserting afterwards let a concurrent settlement slip between the two,
 * and computed the remainder in floats.
 */
export async function allocateBillSettlement(input: z.infer<typeof allocationSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser(); if (!auth.ok) return auth;
  const parsed = allocationSchema.safeParse(input); if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid allocation");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("allocate_bill_settlement", {
    p_document_id: parsed.data.documentId,
    p_settlement_voucher_line_id: parsed.data.settlementVoucherLineId,
    p_amount: parsed.data.amount,
    p_allocation_date: parsed.data.allocationDate,
  });
  if (error) return fail(error.message);
  const allocation = data as { id?: string } | null;
  if (!allocation?.id) return fail("Could not allocate receipt/payment");
  revalidatePath("/business"); revalidatePath("/reports"); return ok({ id: allocation.id });
}

const reversalSchema = z.object({ allocationId: z.string().uuid(), reason: z.string().trim().min(1).max(500) });

export async function reverseBillAllocation(input: z.infer<typeof reversalSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser(); if (!auth.ok) return auth;
  const parsed = reversalSchema.safeParse(input); if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid reversal");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reverse_bill_allocation", {
    p_allocation_id: parsed.data.allocationId,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error.message);
  const allocation = data as { id?: string } | null;
  if (!allocation?.id) return fail("Could not reverse allocation");
  revalidatePath("/business"); revalidatePath("/reports"); return ok({ id: allocation.id });
}
