import { ExpenseHeadForm } from "@/components/masters/expense-head-form";
import { DataTable, PageHeader } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";

export default async function ExpenseHeadsPage() {
  const supabase = await createClient();
  const [{data:companies},{data:ledgers},{data:heads}] = await Promise.all([
    supabase.from("companies").select("id,code,name").eq("is_active",true).order("code"),
    supabase.from("ledgers").select("id,company_id,code,name,account_groups!inner(nature)").eq("is_active",true).is("deleted_at",null).eq("account_groups.nature","expense").order("code"),
    supabase.from("expense_heads").select("code,name,is_active,companies(code,name),ledgers(code,name)").order("code"),
  ]);
  return <div className="space-y-8"><PageHeader title="Expense Head Master" description="Create company-wise expense classifications linked to the correct expense ledger."/><ExpenseHeadForm companies={companies??[]} ledgers={(ledgers??[]).map(({id,company_id,code,name})=>({id,company_id,code,name}))}/><section className="space-y-3"><h2 className="text-lg font-semibold">All expense heads</h2><DataTable columns={["Company","Code","Expense head","Linked ledger","Active"]} rows={(heads??[]).map((head)=>[(head.companies as unknown as {code:string}|null)?.code??"—",head.code,head.name,(head.ledgers as unknown as {name:string}|null)?.name??"—",head.is_active?"Yes":"No"])}/></section></div>;
}
