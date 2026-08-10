import { CashEntryForm } from "@/components/cash-book/cash-entry-form";
import { CashTransferForm, CashVerificationForm, PrintCashBookButton } from "@/components/cash-book/cash-book-controls";
import { OpeningBalanceActions } from "@/components/masters/opening-balance-actions";
import { DataTable, PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function CashBookPage() {
  const supabase = await createClient();
  const auth = await requireUser();
  const canApprove = auth.ok && (auth.data.roles.includes("admin") || auth.data.permissions["vouchers.approve"]);
  const canPost = auth.ok && (auth.data.roles.includes("admin") || auth.data.permissions["vouchers.post"]);
  const [
    { data: companies },
    { data: locations },
    { data: financialYears },
    { data: ledgers },
    { data: vouchers },
    { data: postings },
    { data: verifications },
  ] = await Promise.all([
    supabase.from("companies").select("id, code, name").order("code"),
    supabase.from("locations").select("id, company_id, code, name, cash_ledger_id").eq("is_cash_location", true).not("cash_ledger_id", "is", null).order("code"),
    supabase.from("financial_years").select("id, company_id, code").order("start_date", { ascending: false }),
    supabase.from("ledgers").select("id, company_id, code, name, ledger_type").is("deleted_at", null).eq("is_active", true).order("code"),
    supabase.from("vouchers").select("id, created_by, draft_ref, voucher_number, status, voucher_date, narration, companies(code), voucher_types(code)").order("created_at", { ascending: false }).limit(100),
    supabase
      .from("ledger_postings")
      .select("id, voucher_id, voucher_date, voucher_number, posted_at, location_id, ledger_id, debit_amount, credit_amount, companies(code), locations(code, name, cash_ledger_id), vouchers(narration, voucher_types(code))")
      .order("voucher_date", { ascending: true })
      .order("posted_at", { ascending: true })
      .limit(2000),
    supabase.from("cash_verifications").select("id,verification_date,system_cash_balance,physical_cash_balance,difference,notes,companies(code),locations(code,name)").order("verification_date", { ascending: false }).limit(500),
  ]);

  const cashVouchers = (vouchers ?? []).filter((voucher) => {
    const code = (voucher.voucher_types as unknown as { code: string } | null)?.code;
    return code === "CASH-R" || code === "CASH-P";
  });

  const runningByLocation = new Map<string, number>();
  const cashRows = (postings ?? []).flatMap((posting) => {
    const location = posting.locations as unknown as {
      code: string;
      name: string;
      cash_ledger_id: string | null;
    } | null;
    const voucher = posting.vouchers as unknown as {
      narration: string | null;
      voucher_types: { code: string } | null;
    } | null;
    if (
      !location ||
      location.cash_ledger_id !== posting.ledger_id ||
      !["CASH-R", "CASH-P"].includes(voucher?.voucher_types?.code ?? "")
    ) {
      return [];
    }

    const receipt = Number(posting.debit_amount);
    const payment = Number(posting.credit_amount);
    const locationKey = posting.location_id ?? "";
    const balance = Number(
      ((runningByLocation.get(locationKey) ?? 0) + receipt - payment).toFixed(4),
    );
    runningByLocation.set(locationKey, balance);
    return [{ posting, location, voucher, receipt, payment, balance }];
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Cash Book"
        description="Location-wise cash receipts and payments with a running balance. Entries remain drafts until an authorised approver approves and posts them."
      />
      <CashEntryForm
        companies={companies ?? []}
        locations={locations ?? []}
        financialYears={financialYears ?? []}
        ledgers={ledgers ?? []}
      />
      <div><h2 className="mb-3 text-lg font-semibold">Cash transfer between locations</h2><CashTransferForm companies={companies ?? []} locations={(locations ?? []).map((location)=>({id:location.id,company_id:location.company_id,code:location.code,name:location.name}))} years={financialYears ?? []} ledgers={ledgers ?? []}/></div>
      <div>
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Posted cash register</h2><PrintCashBookButton /></div>
        <div className="space-y-6">{Array.from(new Map(cashRows.map((row) => [row.posting.location_id ?? "", row.location])).entries()).map(([locationId, registerLocation]) => <section key={locationId} className="break-inside-avoid"><h3 className="mb-2 font-semibold">{registerLocation.code} — {registerLocation.name}</h3><DataTable
          columns={["Company", "Date", "Voucher", "Particulars", "Received", "Paid", "Balance"]}
          rows={cashRows.filter((row) => row.posting.location_id === locationId).map(({ posting, voucher, receipt, payment, balance }) => [
            (posting.companies as unknown as { code: string } | null)?.code ?? "—", posting.voucher_date, posting.voucher_number,
            voucher?.narration ?? "—", receipt > 0 ? formatMoney(receipt) : "—", payment > 0 ? formatMoney(payment) : "—", formatMoney(balance),
          ])}
        /></section>)}</div>
      </div>
      <div>
        <h2 className="mb-3 text-lg font-semibold">Daily physical cash verification</h2>
        <CashVerificationForm companies={companies ?? []} locations={(locations ?? []).map((location) => ({ id: location.id, company_id: location.company_id, code: location.code, name: location.name }))} />
        <div className="mt-4"><DataTable columns={["Company","Location","Date","System cash","Physical cash","Difference","Notes"]} rows={(verifications ?? []).map((row) => [(row.companies as unknown as {code:string}|null)?.code ?? "—", `${(row.locations as unknown as {code:string;name:string}|null)?.code ?? "—"} — ${(row.locations as unknown as {code:string;name:string}|null)?.name ?? "—"}`, row.verification_date, formatMoney(row.system_cash_balance), formatMoney(row.physical_cash_balance), formatMoney(row.difference), row.notes ?? "—"])} /></div>
      </div>
      <div>
        <h2 className="mb-3 text-lg font-semibold">Draft and approval queue</h2>
        <DataTable
          columns={["Company", "Date", "Voucher", "Type", "Status", "Actions", "Narration"]}
          rows={cashVouchers.filter((voucher) => voucher.status !== "posted").map((voucher) => [
            (voucher.companies as unknown as { code: string } | null)?.code ?? "—",
            voucher.voucher_date,
            voucher.voucher_number ?? voucher.draft_ref,
            (voucher.voucher_types as unknown as { code: string } | null)?.code ?? "—",
            voucher.status,
            <OpeningBalanceActions
              key={voucher.id}
              voucherId={voucher.id}
              status={voucher.status}
              canPost={canPost}
              canApprove={canApprove && (auth.ok && (auth.data.roles.includes("admin") || voucher.created_by !== auth.data.userId))}
            />,
            voucher.narration ?? "—",
          ])}
        />
      </div>
    </div>
  );
}
