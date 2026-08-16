import { ReportWorkbench } from "@/components/reports/report-workbench";
import { AccessDenied, PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

async function fetchAllLedgerPostings(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows: unknown[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("ledger_postings").select("id, voucher_id, voucher_date, voucher_number, company_id, financial_year_id, ledger_id, party_id, debit_amount, credit_amount, ledgers(code, name, ledger_type, account_groups(nature, bs_pl_section, cash_flow_category, working_capital_class)), parties(code, name), vouchers(narration, voucher_types(code))").order("voucher_date", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error(`Could not load ledger postings: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }
  return rows;
}

async function fetchAllBusinessDocuments(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows: unknown[] = []; const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const select = "id, company_id, party_id, document_type, document_number, document_date, due_date, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, tds_amount, total_amount, eway_bill_no, companies(code), parties(code,name,party_kinds), voucher_allocations(amount)";
    let result = await supabase.from("business_documents").select(select).is("voucher_allocations.reversed_at", null).order("document_date", { ascending: false }).range(from, from + pageSize - 1);
    // Migration 030 adds allocation reversals. Keep reports usable while a
    // deployment is between the application release and that DB migration.
    if (result.error?.message.includes("reversed_at")) {
      result = await supabase.from("business_documents").select(select).order("document_date", { ascending: false }).range(from, from + pageSize - 1);
    }
    if (result.error) throw new Error(`Could not load business documents: ${result.error.message}`);
    rows.push(...(result.data ?? [])); if ((result.data ?? []).length < pageSize) break;
  }
  return rows;
}

async function fetchAllCommissionLines(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows: unknown[] = []; const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("business_document_lines").select("taxable_amount, salesmen(name, role_type, default_commission_pct), business_documents(document_type, document_number, document_date, company_id, party_id, companies(code))").not("salesman_id", "is", null).range(from, from + pageSize - 1);
    if (error) throw new Error(`Could not load commission lines: ${error.message}`);
    rows.push(...(data ?? [])); if ((data ?? []).length < pageSize) break;
  }
  return rows;
}

async function fetchAllSalaries(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows: unknown[] = []; const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("salary_register").select("company_id, employee_party_id, salary_month, gross_amount, deductions, net_amount, employer_contribution, status, companies(code), parties:employee_party_id(code,name), locations(code)").order("salary_month", { ascending: false }).range(from, from + pageSize - 1);
    if (error) throw new Error(`Could not load salary register: ${error.message}`);
    rows.push(...(data ?? [])); if ((data ?? []).length < pageSize) break;
  }
  return rows;
}

async function fetchAllBankStatementLines(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows: unknown[] = []; const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("bank_statement_lines")
      .select("id, import_id, statement_sequence, bank_account_id, txn_date, value_date, description, reference, transaction_type, debit_amount, credit_amount, balance_after, match_status, suggested_party_id, counterparty_bank_account_id, bank_accounts!bank_statement_lines_bank_account_id_fkey(company_id, account_name, account_number), bank_statement_imports!bank_statement_lines_import_id_fkey(imported_at)")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Could not load uploaded bank statement: ${error.message}`);
    rows.push(...(data ?? [])); if ((data ?? []).length < pageSize) break;
  }
  return rows;
}

export default async function ReportsPage() {
  const auth = await requireUser();
  if (!auth.ok || (!auth.data.roles.includes("admin") && !auth.data.permissions["reports.company"])) {
    return <AccessDenied message="Entry Operator users can create entries but cannot view accounting reports." />;
  }
  const supabase = await createClient();
  const [{ data: companies }, { data: financialYears }, postings, { data: closingStocks }, documents, documentLines, salaries, bankStatementLines, { data: parties }, { data: groupBankAccounts }] = await Promise.all([
    supabase.from("companies").select("id, group_id, code, name").order("code"),
    supabase.from("financial_years").select("id, company_id, code").order("start_date", { ascending: false }),
    fetchAllLedgerPostings(supabase),
    supabase.from("closing_stock_entries").select("company_id,financial_year_id,as_of_date,amount,status").eq("status", "approved").order("as_of_date", { ascending: false }),
    fetchAllBusinessDocuments(supabase),
    fetchAllCommissionLines(supabase),
    fetchAllSalaries(supabase),
    fetchAllBankStatementLines(supabase),
    supabase.from("parties").select("id,group_id,code,name,party_kinds").eq("is_active", true).is("deleted_at", null).order("name"),
    supabase.from("bank_accounts").select("id,company_id,account_name,account_number,companies(group_id,code,name)").eq("is_active", true).is("deleted_at", null).order("account_name"),
  ]);
  return <div className="space-y-10">
    <PageHeader title="Accounting & business reports" description="Company-wise and consolidated posted-data reports, statutory summaries, ageing, commission and payroll." />
    <ReportWorkbench companies={companies ?? []} financialYears={financialYears ?? []} postings={postings as never[]} closingStocks={closingStocks ?? []} documents={documents as never[]} documentLines={documentLines as never[]} salaries={salaries as never[]} bankStatementLines={bankStatementLines as never[]} parties={parties ?? []} groupBankAccounts={groupBankAccounts as never[]} />
  </div>;
}
