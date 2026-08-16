import { ContraEntryForm } from "@/components/entries/contra-entry-form";
import { TransactionTypeNav } from "@/components/transactions/transaction-type-nav";
import { PageHeader } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";

export default async function ContraTransactionPage() {
  const supabase = await createClient();
  const [{ data: companies }, { data: locations }, { data: years }, { data: accounts }] = await Promise.all([
    supabase.from("companies").select("id,code,name").eq("is_active", true).is("deleted_at", null).order("code"),
    supabase.from("locations").select("id,company_id,code,name").eq("is_cash_location", true).not("cash_ledger_id", "is", null).order("code"),
    supabase.from("financial_years").select("id,company_id,code").order("start_date", { ascending: false }),
    supabase.from("bank_accounts").select("id,company_id,account_name,account_number").eq("is_active", true).is("deleted_at", null).order("account_name"),
  ]);
  return <div className="space-y-8"><TransactionTypeNav active="contra" /><PageHeader title="Contra" description="Cash deposit into bank or cash withdrawal from bank. One controlled Contra voucher is created." /><ContraEntryForm companies={companies ?? []} locations={locations ?? []} years={years ?? []} accounts={accounts ?? []} /></div>;
}
