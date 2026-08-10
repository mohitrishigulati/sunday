import { OpeningBalanceForm } from "@/components/masters/opening-balance-form";
import { OpeningBalanceActions } from "@/components/masters/opening-balance-actions";
import { DataTable, PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export default async function OpeningBalancesPage() {
  const supabase = await createClient();
  const auth = await requireUser();
  const canApprove = auth.ok && (auth.data.roles.includes("admin") || auth.data.permissions["vouchers.approve"]);
  const canPost = auth.ok && (auth.data.roles.includes("admin") || auth.data.permissions["vouchers.post"]);
  const [{ data: companies }, { data: years }, { data: ledgers }, { data: vouchers }] =
    await Promise.all([
      supabase.from("companies").select("id, code, name").order("code"),
      supabase
        .from("financial_years")
        .select("id, code, company_id, start_date")
        .order("start_date", { ascending: false }),
      supabase
        .from("ledgers")
        .select("id, code, name, company_id")
        .is("deleted_at", null)
        .order("code"),
      supabase
        .from("vouchers")
        .select(
          "id, created_by, draft_ref, voucher_number, status, voucher_date, narration, companies(code), voucher_types!inner(code)",
        )
        // Filter on the joined voucher type, not after the limit — otherwise 50
        // recent non-OB vouchers would hide every opening balance.
        .eq("voucher_types.code", "OB")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const obVouchers = vouchers ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Opening balances"
        description="Opening balances are posted vouchers, not editable master balances. Drafts may be saved unbalanced; posting requires Dr = Cr and generates a gapless OB number."
      />
      <OpeningBalanceForm
        companies={companies ?? []}
        financialYears={years ?? []}
        ledgers={ledgers ?? []}
      />
      <DataTable
        columns={["Company", "Date", "Draft / Number", "Status", "Actions", "Narration"]}
        rows={obVouchers.map((v) => [
          (v.companies as unknown as { code: string } | null)?.code ?? "—",
          v.voucher_date,
          v.voucher_number ?? v.draft_ref,
          v.status,
          <OpeningBalanceActions
            key={v.id}
            voucherId={v.id}
            status={v.status}
            canApprove={
              canApprove &&
              (auth.ok && (auth.data.roles.includes("admin") || v.created_by !== auth.data.userId))
            }
            canPost={canPost}
          />,
          v.narration ?? "—",
        ])}
      />
    </div>
  );
}
