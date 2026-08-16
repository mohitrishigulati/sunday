import { CashEntryForm } from "@/components/cash-book/cash-entry-form";
import { BankEntryForm } from "@/components/entries/bank-entry-form";
import { TransactionTypeNav } from "@/components/transactions/transaction-type-nav";
import { PageHeader } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";

export default async function ReceiptTransactionPage() {
  const supabase = await createClient();
  const [
    { data: companies },
    { data: locations },
    { data: financialYears },
    { data: ledgers },
    { data: parties },
    { data: bankAccounts },
    { data: groups },
    { data: banks },
  ] = await Promise.all([
    supabase.from("companies").select("id, group_id, code, name").order("code"),
    supabase.from("locations").select("id, company_id, code, name, cash_ledger_id").eq("is_cash_location", true).not("cash_ledger_id", "is", null).order("code"),
    supabase.from("financial_years").select("id, company_id, code, start_date, end_date").order("start_date", { ascending: false }),
    supabase.from("ledgers").select("id, company_id, party_id, code, name, ledger_type").is("deleted_at", null).eq("is_active", true).order("code"),
    supabase.from("parties").select("id, group_id, code, name, party_kinds").is("deleted_at", null).order("name"),
    supabase.from("bank_accounts").select("id, company_id, account_name, account_number, ledger_id").eq("is_active", true).is("deleted_at", null).order("account_name"),
    supabase.from("company_groups").select("id,code,name").eq("is_active", true).order("code"),
    supabase.from("banks").select("id,code,name").order("code"),
  ]);

  return (
    <div className="space-y-8">
      <TransactionTypeNav active="receipt" />
      <PageHeader title="Receipt" description="Cash aaya ya bank mein receive hua. Party / ledger choose karke save karo." />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Cash receipt</h2>
        <CashEntryForm
          companies={companies ?? []}
          locations={locations ?? []}
          financialYears={financialYears ?? []}
          ledgers={ledgers ?? []}
          parties={parties ?? []}
          mode="receipt"
        />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Bank receipt</h2>
        <BankEntryForm
          companies={(companies ?? []).map(({ id, code, name }) => ({ id, code, name }))}
          financialYears={financialYears ?? []}
          ledgers={ledgers ?? []}
          bankAccounts={bankAccounts ?? []}
          groups={groups ?? []}
          banks={banks ?? []}
          lockedKind="receipt"
        />
      </section>
    </div>
  );
}
