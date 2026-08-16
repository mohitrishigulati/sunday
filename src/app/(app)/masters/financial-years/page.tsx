import { FinancialYearForm } from "@/components/masters/financial-year-form";
import { DataTable, PageHeader } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";

export default async function FinancialYearsPage() {
  const supabase = await createClient();
  const [{ data: companies }, { data: years }] = await Promise.all([
    supabase.from("companies").select("id, code, name").order("code"),
    supabase
      .from("financial_years")
      .select("code, start_date, end_date, is_closed, companies(code)")
      .order("start_date", { ascending: false }),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Financial years"
        description="Indian financial year is 1 April to 31 March. It is created automatically for new companies and when a bank statement is imported."
      />
      <FinancialYearForm companies={companies ?? []} />
      <DataTable
        columns={["Company", "Code", "Start", "End", "Closed"]}
        rows={(years ?? []).map((y) => [
          (y.companies as unknown as { code: string } | null)?.code ?? "—",
          y.code,
          y.start_date,
          y.end_date,
          y.is_closed ? "Yes" : "No",
        ])}
      />
    </div>
  );
}
