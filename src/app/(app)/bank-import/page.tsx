import { BankLineMatcher, CreateEntryFromStatementLine, ReconciliationForm } from "@/components/bank-import/reconciliation-actions";
import { StatementImportForm } from "@/components/bank-import/statement-import-form";
import { AttachmentLink } from "@/components/attachments/attachment-link";
import { AccessDenied, DataTable, PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type UnmatchedBankLine = {
  id: string;
  import_id: string;
  statement_sequence: number;
  txn_date: string;
  value_date: string | null;
  description: string | null;
  reference: string | null;
  transaction_type: string | null;
  debit_amount: number | string;
  credit_amount: number | string;
  balance_after: number | string | null;
  bank_account_id: string;
  bank_accounts: { company_id: string; account_name: string } | null;
  bank_statement_imports: { imported_at: string } | null;
};

async function fetchAllUnmatchedBankLines(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows: UnmatchedBankLine[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("bank_statement_lines")
      .select("id, import_id, bank_account_id, statement_sequence, txn_date, value_date, description, reference, transaction_type, debit_amount, credit_amount, balance_after, bank_accounts!bank_statement_lines_bank_account_id_fkey(company_id, account_name), bank_statement_imports!bank_statement_lines_import_id_fkey(imported_at)")
      .eq("match_status", "unmatched")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Could not load unmatched bank transactions: ${error.message}`);
    rows.push(...((data ?? []) as unknown as UnmatchedBankLine[]));
    if ((data ?? []).length < pageSize) break;
  }
  return rows.sort((left, right) => {
    const importOrder = (right.bank_statement_imports?.imported_at ?? "").localeCompare(
      left.bank_statement_imports?.imported_at ?? "",
    );
    return importOrder || left.statement_sequence - right.statement_sequence;
  });
}

export default async function BankImportPage() {
  const auth = await requireUser();
  if (!auth.ok || (!auth.data.roles.includes("admin") && !auth.data.permissions["bank.statements.view"])) {
    return <AccessDenied message="This user can make accounting entries but cannot view, upload or reconcile bank statements." />;
  }

  const supabase = await createClient();
  const [{ data: companies }, { data: accounts }, { data: groups }, { data: banks }, { data: imports }, unmatched, { data: vouchers }, { data: reconciliations }, { data: years }, { data: ledgers }] = await Promise.all([
    supabase.from("companies").select("id, code, name").order("code"),
    supabase.from("bank_accounts").select("id, company_id, account_name, account_number").eq("is_active", true).is("deleted_at", null),
    supabase.from("company_groups").select("id,code,name").eq("is_active", true).order("code"),
    supabase.from("banks").select("id,code,name").order("code"),
    supabase.from("bank_statement_imports").select("id, file_name, source_format, imported_at, closing_balance, calculated_closing, balance_mismatch, bank_accounts(account_name), companies(code), attachments(storage_path,file_name)").order("imported_at", { ascending: false }).limit(100),
    fetchAllUnmatchedBankLines(supabase),
    supabase.from("vouchers").select("id, company_id, voucher_number, voucher_date").eq("status", "posted").not("voucher_number", "is", null).order("voucher_date", { ascending: false }).limit(500),
    supabase.from("bank_reconciliations").select("as_of_date, statement_closing, book_closing, difference, status, bank_accounts(account_name)").order("as_of_date", { ascending: false }).limit(100),
    supabase.from("financial_years").select("id,company_id,code").order("start_date", { ascending: false }),
    supabase.from("ledgers").select("id,company_id,code,name,ledger_type").eq("is_active", true).is("deleted_at", null).order("code"),
  ]);

  const postedVouchers = (vouchers ?? []).map((voucher) => ({ ...voucher, voucher_number: voucher.voucher_number! }));

  return <div className="space-y-8">
    <PageHeader title="Bank statement import & reconciliation" description="CSV/XLSX/PDF intake with all statement fields, deduplication, balance validation, voucher matching and reconciliation." />
    <StatementImportForm companies={companies ?? []} accounts={accounts ?? []} groups={groups ?? []} banks={banks ?? []} />

    <div>
      <h2 className="mb-3 text-lg font-semibold">Import history</h2>
      <DataTable columns={["Company", "Bank", "Format", "File", "Attachment", "Imported", "Statement closing", "Calculated", "Result"]} rows={(imports ?? []).map((row) => {
        const attachment = row.attachments as unknown as { storage_path: string; file_name: string } | null;
        return [
          (row.companies as unknown as { code: string } | null)?.code ?? "—",
          (row.bank_accounts as unknown as { account_name: string } | null)?.account_name ?? "—",
          row.source_format.toUpperCase(),
          row.file_name ?? "—",
          attachment ? <AttachmentLink key={row.id} storagePath={attachment.storage_path} fileName={attachment.file_name} /> : "—",
          new Date(row.imported_at).toLocaleString("en-IN"),
          row.closing_balance === null ? "—" : formatMoney(row.closing_balance),
          row.calculated_closing === null ? "—" : formatMoney(row.calculated_closing),
          row.balance_mismatch ? "Mismatch" : "Matched",
        ];
      })} />
    </div>

    <div>
      <h2 className="mb-3 text-lg font-semibold">Unmatched bank transactions</h2>
      <DataTable
        columns={["S.No.", "Transaction date", "Value date", "Bank", "Particulars", "Ref./Cheque No.", "Transaction type", "Debit (Rs)", "Credit (Rs)", "Balance (Rs)", "Create entry / Match"]}
        rows={(unmatched ?? []).map((row) => {
          const bank = row.bank_accounts as unknown as { company_id: string; account_name: string } | null;
          return [
            row.statement_sequence,
            row.txn_date,
            row.value_date ?? "—",
            bank?.account_name ?? "—",
            row.description ?? "—",
            row.reference ?? "—",
            row.transaction_type ?? (Number(row.debit_amount) > 0 ? "Debit" : "Credit"),
            Number(row.debit_amount) ? formatMoney(row.debit_amount) : "—",
            Number(row.credit_amount) ? formatMoney(row.credit_amount) : "—",
            row.balance_after === null ? "—" : formatMoney(row.balance_after),
            <div key={row.id}><BankLineMatcher lineId={row.id} companyId={bank?.company_id ?? ""} vouchers={postedVouchers} /><CreateEntryFromStatementLine line={{ companyId: bank?.company_id ?? "", bankAccountId: row.bank_account_id, date: row.txn_date, description: row.description ?? "", reference: row.reference ?? "", debitAmount: Number(row.debit_amount), creditAmount: Number(row.credit_amount) }} years={years ?? []} ledgers={ledgers ?? []} /></div>,
          ];
        })}
      />
    </div>

    <div>
      <h2 className="mb-3 text-lg font-semibold">Bank reconciliation</h2>
      <ReconciliationForm accounts={accounts ?? []} />
      <div className="mt-4">
        <DataTable columns={["As of", "Bank", "Statement", "Book", "Difference", "Status"]} rows={(reconciliations ?? []).map((row) => [
          row.as_of_date,
          (row.bank_accounts as unknown as { account_name: string } | null)?.account_name ?? "—",
          formatMoney(row.statement_closing),
          formatMoney(row.book_closing),
          formatMoney(row.difference),
          row.status,
        ])} />
      </div>
    </div>
  </div>;
}
