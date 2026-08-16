import { PartyCompanyLinkForm } from "@/components/masters/party-company-link-form";
import { PartyForm } from "@/components/masters/party-form";
import { MasterRowActions } from "@/components/masters/master-row-actions";
import { DataTable, PageHeader } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";

export default async function PartiesPage() {
  const supabase = await createClient();
  const [{ data: groups }, { data: parties }, { data: companies }, { data: ledgers }, { data: links }, { data: accountGroups }] = await Promise.all([
    supabase.from("company_groups").select("id,code,name").order("code"),
    supabase.from("parties").select("id,code,name,party_kinds,gstin,credit_days,is_active,company_groups(code)").order("name"),
    supabase.from("companies").select("id,group_id,code,name").eq("is_active", true).order("code"),
    supabase.from("ledgers").select("id,company_id,party_id,code,name").eq("is_active", true).eq("ledger_type", "party").order("code"),
    supabase.from("party_company_links").select("credit_limit,parties(code,name),companies(code,name),ledgers(code,name)"),
    supabase.from("account_groups").select("id,company_id,code,name,nature").order("name"),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader title="Party Master" description="Add every person or business from whom money is received or to whom money is paid. The same party can be linked with multiple group companies." />
      <div className="grid gap-6 xl:grid-cols-2">
        <PartyForm groups={groups ?? []} companies={companies ?? []} accountGroups={accountGroups ?? []} />
        <PartyCompanyLinkForm companies={companies ?? []} parties={(parties ?? []).filter((party) => party.is_active)} ledgers={ledgers ?? []} />
      </div>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All parties</h2>
        <DataTable columns={["Group", "Code", "Party name", "Account header", "GSTIN", "Credit days", "Active", "Edit"]} rows={(parties ?? []).map((party) => [
          (party.company_groups as unknown as { code: string } | null)?.code ?? "—", party.code, party.name,
          (party.party_kinds ?? []).map((kind: string) => kind === "customer" ? "Debtor" : kind === "supplier" ? "Creditor" : kind === "expense" ? "Expense" : kind).join(", ") || "—",
          party.gstin ?? "—", party.credit_days, party.is_active ? "Yes" : "No",
          <MasterRowActions key={party.id} entity="parties" id={party.id} initialCode={party.code} initialName={party.name} active={party.is_active} />,
        ])} />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Company-wise party ledger links</h2>
        <DataTable columns={["Party", "Company", "Ledger", "Credit limit"]} rows={(links ?? []).map((link) => [
          (link.parties as unknown as { name: string } | null)?.name ?? "—",
          (link.companies as unknown as { code: string } | null)?.code ?? "—",
          (link.ledgers as unknown as { name: string } | null)?.name ?? "—",
          link.credit_limit ?? "—",
        ])} />
      </section>
    </div>
  );
}
