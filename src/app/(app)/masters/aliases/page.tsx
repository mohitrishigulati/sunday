import { AliasForm } from "@/components/masters/alias-form";
import { DataTable, PageHeader } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";

export default async function AliasesPage() {
  const supabase = await createClient();
  const [{ data: parties }, { data: aliases }] = await Promise.all([
    supabase.from("parties").select("id, code, name").order("name"),
    supabase
      .from("party_aliases")
      .select("alias_text, normalized_alias, confirmed, source, parties(code, name)")
      .order("alias_text"),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Party aliases"
        description="Map statement and invoice name variations to one canonical party."
      />
      <AliasForm parties={parties ?? []} />
      <DataTable
        columns={["Party", "Alias", "Normalized", "Source", "Confirmed"]}
        rows={(aliases ?? []).map((a) => {
          const party = a.parties as unknown as { code: string; name: string } | null;
          return [
            party ? `${party.code} — ${party.name}` : "—",
            a.alias_text,
            a.normalized_alias,
            a.source,
            a.confirmed ? "Yes" : "No",
          ];
        })}
      />
    </div>
  );
}
