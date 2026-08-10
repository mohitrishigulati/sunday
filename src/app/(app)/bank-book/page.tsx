import { BankEntryForm } from "@/components/entries/bank-entry-form";
import { OpeningBalanceActions } from "@/components/masters/opening-balance-actions";
import { DataTable, PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function BankBookPage() {
  const supabase = await createClient();
  const auth = await requireUser();
  const canApprove = auth.ok && (auth.data.roles.includes("admin") || auth.data.permissions["vouchers.approve"]);
  const canPost = auth.ok && (auth.data.roles.includes("admin") || auth.data.permissions["vouchers.post"]);
  const [{ data: companies }, { data: financialYears }, { data: ledgers }, { data: bankAccounts }, { data: groups }, { data: banks }, { data: postings }, { data: vouchers }] = await Promise.all([
    supabase.from("companies").select("id, code, name").order("code"),
    supabase.from("financial_years").select("id, company_id, code").order("start_date", { ascending: false }),
    supabase.from("ledgers").select("id, company_id, code, name, ledger_type").eq("is_active", true).is("deleted_at", null).order("code"),
    supabase.from("bank_accounts").select("id, company_id, account_name, account_number, ledger_id").eq("is_active", true).is("deleted_at", null).order("account_name"),
    supabase.from("company_groups").select("id,code,name").eq("is_active", true).order("code"),
    supabase.from("banks").select("id,code,name").order("code"),
    supabase.from("ledger_postings").select("id, voucher_date, voucher_number, posted_at, company_id, ledger_id, debit_amount, credit_amount, companies(code), vouchers(narration, voucher_types(code))").order("voucher_date", { ascending: true }).order("posted_at", { ascending: true }).limit(3000),
    supabase.from("vouchers").select("id, created_by, draft_ref, voucher_number, voucher_date, status, narration, companies(code), voucher_types(code)").order("created_at", { ascending: false }).limit(200),
  ]);
  const accountByLedger = new Map((bankAccounts ?? []).map((account) => [account.ledger_id, account]));
  const balances = new Map<string, number>();
  const bankRows = (postings ?? []).flatMap((posting) => {
    const account = accountByLedger.get(posting.ledger_id);
    const voucher = posting.vouchers as unknown as { narration: string | null; voucher_types: { code: string } | null } | null;
    if (!account || !["BNK-R", "BNK-P", "BNK"].includes(voucher?.voucher_types?.code ?? "")) return [];
    const receipt = Number(posting.debit_amount);
    const payment = Number(posting.credit_amount);
    const balance = Number(((balances.get(account.id) ?? 0) + receipt - payment).toFixed(4));
    balances.set(account.id, balance);
    return [{ posting, account, voucher, receipt, payment, balance }];
  });
  const bankVouchers = (vouchers ?? []).filter((voucher) => ["BNK-R", "BNK-P", "BNK"].includes((voucher.voucher_types as unknown as { code: string } | null)?.code ?? ""));

  return (
    <div className="space-y-8">
      <PageHeader title="Bank Book" description="Bank account-wise receipts, payments and running book balance." />
      <BankEntryForm companies={companies ?? []} financialYears={financialYears ?? []} ledgers={ledgers ?? []} bankAccounts={bankAccounts ?? []} groups={groups ?? []} banks={banks ?? []} />
      <div>
        <h2 className="mb-3 text-lg font-semibold">Posted bank register</h2>
        <DataTable columns={["Company", "Bank account", "Date", "Voucher", "Particulars", "Received", "Paid", "Balance"]} rows={bankRows.map(({ posting, account, voucher, receipt, payment, balance }) => [
          (posting.companies as unknown as { code: string } | null)?.code ?? "—",
          `${account.account_name} — ${account.account_number}`,
          posting.voucher_date,
          posting.voucher_number,
          voucher?.narration ?? "—",
          receipt > 0 ? formatMoney(receipt) : "—",
          payment > 0 ? formatMoney(payment) : "—",
          formatMoney(balance),
        ])} />
      </div>
      <div>
        <h2 className="mb-3 text-lg font-semibold">Draft and approval queue</h2>
        <DataTable columns={["Company", "Date", "Voucher", "Type", "Status", "Actions", "Narration"]} rows={bankVouchers.filter((voucher) => voucher.status !== "posted").map((voucher) => [
          (voucher.companies as unknown as { code: string } | null)?.code ?? "—",
          voucher.voucher_date,
          voucher.voucher_number ?? voucher.draft_ref,
          (voucher.voucher_types as unknown as { code: string } | null)?.code ?? "—",
          voucher.status,
          <OpeningBalanceActions key={voucher.id} voucherId={voucher.id} status={voucher.status} canPost={canPost} canApprove={canApprove && (auth.ok && (auth.data.roles.includes("admin") || voucher.created_by !== auth.data.userId))} />,
          voucher.narration ?? "—",
        ])} />
      </div>
    </div>
  );
}
