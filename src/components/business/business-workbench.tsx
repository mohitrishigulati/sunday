import { BillAllocationForm, BusinessDocumentForm } from "@/components/business/business-document-form";
import { AttachmentLink } from "@/components/attachments/attachment-link";
import { OpeningBalanceActions } from "@/components/masters/opening-balance-actions";
import { DataTable, PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export async function BusinessWorkbench({ lockType }: { lockType?: "sale" | "purchase" } = {}) {
  const supabase = await createClient();
  const auth = await requireUser();
  const canApprove = auth.ok && (auth.data.roles.includes("admin") || auth.data.permissions["vouchers.approve"]);
  const canPost = auth.ok && (auth.data.roles.includes("admin") || auth.data.permissions["vouchers.post"]);
  const [
    { data: companies }, { data: years }, { data: parties }, { data: ledgers },
    { data: costCentres }, { data: salesmen }, { data: documents },
    { data: allocations }, { data: settlementLines },
  ] = await Promise.all([
    supabase.from("companies").select("id,code,name").order("code"),
    supabase.from("financial_years").select("id,company_id,code").order("start_date", { ascending: false }),
    supabase.from("parties").select("id,code,name").eq("is_active", true).is("deleted_at", null).order("code"),
    supabase.from("ledgers").select("id,company_id,code,name,ledger_type,party_id").eq("is_active", true).is("deleted_at", null).order("code"),
    supabase.from("cost_centres").select("id,company_id,code,name").eq("is_active", true).order("code"),
    supabase.from("salesmen").select("id,code,name,role_type").eq("is_active", true).order("code"),
    supabase.from("business_documents").select("id,company_id,party_id,document_type,document_number,document_date,due_date,taxable_amount,cgst_amount,sgst_amount,igst_amount,tds_amount,total_amount,companies(code),parties(code,name),vouchers(id,created_by,status,voucher_number,draft_ref,attachments(storage_path,file_name))").order("document_date", { ascending: false }).limit(500),
    supabase.from("voucher_allocations").select("document_id,settlement_voucher_line_id,amount").is("reversed_at", null),
    supabase.from("voucher_lines").select("id,company_id,party_id,debit_amount,credit_amount,companies(code),parties(name),vouchers!inner(status,voucher_number,voucher_date)").eq("vouchers.status", "posted").not("party_id", "is", null).order("line_no"),
  ]);
  const allocated = new Map<string, number>();
  for (const row of allocations ?? []) allocated.set(row.document_id, (allocated.get(row.document_id) ?? 0) + Number(row.amount));
  const allocatedByLine = new Map<string, number>();
  for (const row of allocations ?? []) allocatedByLine.set(row.settlement_voucher_line_id, (allocatedByLine.get(row.settlement_voucher_line_id) ?? 0) + Number(row.amount));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const visibleDocuments = (documents ?? []).filter((document) => !lockType || document.document_type === lockType);
  const title = lockType === "sale" ? "Sale" : lockType === "purchase" ? "Purchase" : "Sales, purchase & bill settlement";

  return <div className="space-y-8">
    <PageHeader title={title} description="Invoice-line GST/TDS accounting, bill-wise outstanding allocation and due-date ageing." />
    <BusinessDocumentForm companies={companies ?? []} years={years ?? []} parties={parties ?? []} ledgers={ledgers ?? []} costCentres={costCentres ?? []} salesmen={salesmen ?? []} lockType={lockType} />
    <DataTable columns={["Company","Type","Invoice","Date","Party","Taxable","GST","TDS","Total","Outstanding","Ageing","Status","Attachment","Actions","Allocate receipt/payment"]} rows={visibleDocuments.map((document) => {
      const voucher = document.vouchers as unknown as {id:string;created_by:string;status:string;voucher_number:string|null;draft_ref:string;attachments:{storage_path:string;file_name:string}|null}|null;
      const outstanding = Number(document.total_amount) - (allocated.get(document.id) ?? 0);
      const days = Math.floor((today.valueOf() - new Date(`${document.due_date}T00:00:00`).valueOf()) / 86400000);
      const bucket = outstanding <= 0 ? "Settled" : days <= 0 ? "Not due" : days <= 30 ? "0–30" : days <= 60 ? "31–60" : days <= 90 ? "61–90" : "90+";
      const lines = (settlementLines ?? []).filter((line) => line.company_id === document.company_id && line.party_id === document.party_id).map((line) => {
        const v = line.vouchers as unknown as {voucher_number:string;voucher_date:string};
        const remaining = Math.max(Number(line.debit_amount), Number(line.credit_amount)) - (allocatedByLine.get(line.id) ?? 0);
        return { id: line.id, label: `${v.voucher_number} ${v.voucher_date} (${formatMoney(remaining)} available)`, remaining };
      }).filter((line) => line.remaining > 0);
      return [
        (document.companies as unknown as {code:string}|null)?.code ?? "—", document.document_type,
        document.document_number, document.document_date, (document.parties as unknown as {name:string}|null)?.name ?? "—",
        formatMoney(document.taxable_amount), formatMoney(Number(document.cgst_amount) + Number(document.sgst_amount) + Number(document.igst_amount)),
        formatMoney(document.tds_amount), formatMoney(document.total_amount), formatMoney(outstanding), bucket, voucher?.status ?? "—", voucher?.attachments?<AttachmentLink storagePath={voucher.attachments.storage_path} fileName={voucher.attachments.file_name}/>:"—",
        voucher ? <OpeningBalanceActions key={voucher.id} voucherId={voucher.id} status={voucher.status} canPost={canPost} canApprove={canApprove && (auth.ok && (auth.data.roles.includes("admin") || voucher.created_by !== auth.data.userId))} /> : "—",
        voucher?.status === "posted" ? <BillAllocationForm key={`a-${document.id}`} documentId={document.id} outstanding={outstanding} settlementLines={lines} /> : "Post invoice first",
      ];
    })} />
    <div><h2 className="mb-3 text-lg font-semibold">On-account receipts / payments</h2><DataTable columns={["Company","Party","Voucher","Date","Line amount","Allocated","On-account"]} rows={(settlementLines ?? []).flatMap((line) => { const total = Math.max(Number(line.debit_amount), Number(line.credit_amount)); const used = allocatedByLine.get(line.id) ?? 0; const balance = total - used; if (balance <= 0) return []; const voucher = line.vouchers as unknown as {voucher_number:string;voucher_date:string}; return [[(line.companies as unknown as {code:string}|null)?.code ?? "—", (line.parties as unknown as {name:string}|null)?.name ?? "—", voucher.voucher_number, voucher.voucher_date, formatMoney(total), formatMoney(used), formatMoney(balance)]]; })} /></div>
  </div>;
}
