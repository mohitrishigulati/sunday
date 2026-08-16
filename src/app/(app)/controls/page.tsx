import { ApproveClosingStockButton, ClosingStockForm, FinancialYearCloseForm, PeriodLockButton, ReversalForm } from "@/components/controls/financial-controls";
import { AccessDenied, DataTable, PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type AuditPayload = Record<string, unknown> | null;

function auditDetail(table: string, recordId: string, before: AuditPayload, after: AuditPayload, context: AuditPayload) {
  const row = after ?? before ?? {};
  const label = ["voucher_number", "draft_ref", "code", "name", "account_name", "file_name", "alias_text", "document_number"]
    .map((key) => row[key])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const narration = typeof row.narration === "string" ? row.narration : null;
  const reason = typeof context?.reason === "string" ? context.reason : null;
  return [label ? `${table}: ${label}` : `${table}: ${recordId}`, narration, reason].filter(Boolean).join(" — ");
}

export default async function ControlsPage() {
  const auth = await requireUser();
  if (!auth.ok || (!auth.data.roles.includes("admin") && !auth.data.permissions["periods.lock"])) {
    return <AccessDenied message="Entry Operator users cannot view accounting controls or audit reports." />;
  }
  const supabase = await createClient();
  const [{ data: periods }, { data: vouchers }, { data: audit }, { data: companies }, { data: years }, { data: equityLedgers }, { data: closures }, { data: closingStocks }] = await Promise.all([
    supabase.from("accounting_periods").select("id, period_no, start_date, end_date, is_locked, companies(code), financial_years(code)").order("start_date", { ascending: false }).limit(120),
    supabase.from("vouchers").select("id, voucher_number, voucher_date, companies(code)").eq("status", "posted").is("reversed_by_voucher_id", null).not("voucher_number", "is", null).order("voucher_date", { ascending: false }).limit(200),
    supabase.from("audit_log").select("occurred_at, actor_id, table_name, record_id, action, old_row, new_row, context, companies(code), profiles!audit_log_actor_id_fkey(full_name,email)").order("occurred_at", { ascending: false }).limit(200),
    supabase.from("companies").select("id,code,name").order("code"),
    supabase.from("financial_years").select("id, company_id, code, is_closed").order("start_date", { ascending: false }),
    supabase.from("ledgers").select("id, company_id, code, name, account_groups!inner(nature)").eq("account_groups.nature", "equity").eq("is_active", true),
    supabase.from("financial_year_closures").select("closed_at, companies(code), from_year:from_financial_year_id(code), to_year:to_financial_year_id(code), vouchers:opening_voucher_id(voucher_number)").order("closed_at", { ascending: false }),
    supabase.from("closing_stock_entries").select("id,as_of_date,amount,status,narration,companies(code),financial_years(code)").order("as_of_date", { ascending: false }).limit(200),
  ]);
  const reversalVouchers = (vouchers ?? []).map((voucher) => ({ id: voucher.id, voucher_number: voucher.voucher_number!, voucher_date: voucher.voucher_date, company_code: (voucher.companies as unknown as { code: string } | null)?.code ?? "—" }));
  return <div className="space-y-8">
    <PageHeader title="Accounting controls" description="Period locking, financial-year close/carry-forward, controlled reversals and immutable audit history." />
    <div><h2 className="mb-3 text-lg font-semibold">Closing stock for Trading Account</h2><ClosingStockForm companies={companies ?? []} years={years ?? []}/><div className="mt-4"><DataTable columns={["Company","FY","As of","Amount","Status","Narration","Action"]} rows={(closingStocks ?? []).map((row)=>[(row.companies as unknown as {code:string}|null)?.code??"—",(row.financial_years as unknown as {code:string}|null)?.code??"—",row.as_of_date,formatMoney(row.amount),row.status,row.narration??"—",row.status==="draft"?<ApproveClosingStockButton key={row.id} id={row.id}/>:"Approved"])} /></div></div>
    <div><h2 className="mb-3 text-lg font-semibold">Financial-year close</h2><FinancialYearCloseForm years={years ?? []} equityLedgers={equityLedgers ?? []} /><div className="mt-4"><DataTable columns={["Company", "From FY", "To FY", "Opening voucher", "Closed at"]} rows={(closures ?? []).map((row) => [(row.companies as unknown as { code: string } | null)?.code ?? "—", (row.from_year as unknown as { code: string } | null)?.code ?? "—", (row.to_year as unknown as { code: string } | null)?.code ?? "—", (row.vouchers as unknown as { voucher_number: string } | null)?.voucher_number ?? "—", new Date(row.closed_at).toLocaleString("en-IN")])} /></div></div>
    <div><h2 className="mb-3 text-lg font-semibold">Voucher reversal</h2><ReversalForm vouchers={reversalVouchers} /></div>
    <div><h2 className="mb-3 text-lg font-semibold">Accounting periods</h2><DataTable columns={["Company", "FY", "Period", "From", "To", "Status", "Action"]} rows={(periods ?? []).map((period) => [(period.companies as unknown as { code: string } | null)?.code ?? "—", (period.financial_years as unknown as { code: string } | null)?.code ?? "—", period.period_no, period.start_date, period.end_date, period.is_locked ? "Locked" : "Open", <PeriodLockButton key={period.id} periodId={period.id} locked={period.is_locked} />])} /></div>
    <div><h2 className="mb-1 text-lg font-semibold">Activity & audit log</h2><p className="mb-3 text-sm text-[var(--muted)]">Immutable history of who created, changed, approved, posted, reversed, or matched a record. System actions are identified separately.</p><DataTable columns={["Time", "Company", "Who", "Action", "What changed"]} rows={(audit ?? []).map((row) => { const actor = row.profiles as unknown as { full_name: string | null; email: string | null } | null; return [new Date(row.occurred_at).toLocaleString("en-IN"), (row.companies as unknown as { code: string } | null)?.code ?? "—", actor?.full_name || actor?.email || (row.actor_id ? `User ${row.actor_id.slice(0, 8)}` : "System"), row.action, auditDetail(row.table_name, row.record_id, row.old_row as AuditPayload, row.new_row as AuditPayload, row.context as AuditPayload)]; })} /></div>
  </div>;
}
