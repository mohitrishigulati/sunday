import { BankAccountForm } from "@/components/masters/bank-account-form";
import { BankMasterForm } from "@/components/masters/bank-master-form";
import { MasterRowActions } from "@/components/masters/master-row-actions";
import { DataTable, PageHeader } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";

export default async function BankAccountsPage() {
  const supabase = await createClient();
  const [{ data: companies }, { data: banks }, { data: rows }] = await Promise.all([
    supabase.from("companies").select("id,code,name").eq("is_active", true).order("code"),
    supabase.from("banks").select("id,code,name").order("code"),
    supabase.from("bank_accounts").select("id,account_name,account_number,ifsc,account_type,is_active,companies(code),banks(code)").order("account_name"),
  ]);
  return <div className="space-y-8">
    <PageHeader title="Bank accounts" description="Each account belongs to exactly one company and has its own ledger." />
    <section className="space-y-3"><h2 className="text-lg font-semibold">Bank not listed?</h2><BankMasterForm /></section>
    <BankAccountForm companies={companies ?? []} banks={banks ?? []} />
    <DataTable columns={["Company", "Bank", "Name", "Number", "IFSC", "Type", "Active", "Edit"]} rows={(rows ?? []).map((row) => [
      (row.companies as unknown as { code: string } | null)?.code ?? "—",
      (row.banks as unknown as { code: string } | null)?.code ?? "—",
      row.account_name,
      row.account_number,
      row.ifsc ?? "—",
      row.account_type ?? "—",
      row.is_active ? "Yes" : "No",
      <MasterRowActions key={row.id} entity="bank_accounts" id={row.id} initialName={row.account_name} active={row.is_active} />,
    ])} />
  </div>;
}
