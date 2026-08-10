import { JournalEntryForm } from "@/components/entries/journal-entry-form";
import { OpeningBalanceActions } from "@/components/masters/opening-balance-actions";
import { DataTable, PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function JournalsPage() {
  const supabase = await createClient();
  const auth = await requireUser();
  const canApprove = auth.ok && (auth.data.roles.includes("admin") || auth.data.permissions["vouchers.approve"]);
  const canPost = auth.ok && (auth.data.roles.includes("admin") || auth.data.permissions["vouchers.post"]);
  const [{ data: companies }, { data: financialYears }, { data: ledgers }, { data: groups }, { data: banks }, { data: vouchers }] = await Promise.all([
    supabase.from("companies").select("id, code, name").order("code"),
    supabase.from("financial_years").select("id, company_id, code").order("start_date", { ascending: false }),
    supabase.from("ledgers").select("id, company_id, code, name").eq("is_active", true).is("deleted_at", null).order("code"),
    supabase.from("company_groups").select("id,code,name").eq("is_active", true).order("code"),
    supabase.from("banks").select("id,code,name").order("code"),
    supabase.from("vouchers").select("id, created_by, draft_ref, voucher_number, voucher_date, status, narration, companies(code), voucher_types(code), voucher_lines(debit_amount, credit_amount)").order("voucher_date", { ascending: false }).limit(200),
  ]);
  const journals = (vouchers ?? []).filter((voucher) => (voucher.voucher_types as unknown as { code: string } | null)?.code === "JV");

  return (
    <div className="space-y-8">
      <PageHeader title="Journal vouchers" description="Balanced multi-line journal entries with maker-checker approval and controlled posting." />
      <JournalEntryForm companies={companies ?? []} financialYears={financialYears ?? []} ledgers={ledgers ?? []} groups={groups ?? []} banks={banks ?? []} />
      <DataTable
        columns={["Company", "Date", "Voucher", "Status", "Debit", "Credit", "Actions", "Narration"]}
        rows={journals.map((voucher) => {
          const lines = voucher.voucher_lines as unknown as Array<{ debit_amount: number | string; credit_amount: number | string }>;
          const debit = lines.reduce((sum, line) => sum + Number(line.debit_amount), 0);
          const credit = lines.reduce((sum, line) => sum + Number(line.credit_amount), 0);
          return [
            (voucher.companies as unknown as { code: string } | null)?.code ?? "—",
            voucher.voucher_date,
            voucher.voucher_number ?? voucher.draft_ref,
            voucher.status,
            formatMoney(debit),
            formatMoney(credit),
            <OpeningBalanceActions key={voucher.id} voucherId={voucher.id} status={voucher.status} canPost={canPost} canApprove={canApprove && (auth.ok && (auth.data.roles.includes("admin") || voucher.created_by !== auth.data.userId))} />,
            voucher.narration ?? "—",
          ];
        })}
      />
    </div>
  );
}
