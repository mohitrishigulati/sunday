import Link from "next/link";
import { DashboardShortcuts } from "@/components/dashboard/dashboard-shortcuts";
import { StatementImportForm } from "@/components/bank-import/statement-import-form";
import { AccessDenied, Card, DataTable, PageHeader } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/guards";

type Money = string | number;
type DailyBalance = {
  as_of_date: string;
  balance_kind: "cash" | "bank";
  company_id: string;
  company_code: string;
  entity_id: string;
  entity_code: string;
  entity_name: string;
  opening_balance: Money;
  receipts: Money;
  payments: Money;
  closing_balance: Money;
  statement_opening: Money | null;
  statement_closing: Money | null;
  statement_book_difference: Money | null;
  last_statement_to: string | null;
  statement_current: boolean;
};
type DailySummary = {
  as_of_date: string;
  cash_opening: Money;
  cash_receipts: Money;
  cash_payments: Money;
  cash_closing: Money;
  bank_opening: Money;
  bank_receipts: Money;
  bank_payments: Money;
  bank_closing: Money;
  total_opening: Money;
  total_receipts: Money;
  total_payments: Money;
  total_closing: Money;
  missing_statement_accounts: number;
};

function todayInIndia() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = new Map(parts.map((part) => [part.type, part.value]));
  return `${value.get("year")}-${value.get("month")}-${value.get("day")}`;
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${value}T12:00:00+05:30`));
}

export default async function DashboardPage() {
  const auth = await requireUser();
  if (!auth.ok) return <AccessDenied message="Sign in to continue." />;
  const isEntryOnly = !auth.data.roles.includes("admin") && !auth.data.permissions["reports.company"];
  if (isEntryOnly) {
    return <div className="space-y-6">
      <PageHeader title="Aaj ka kaam" description="Aap entries bana sakte ho. Reports restricted hain." actions={<Link href="/help" className="text-sm font-medium text-[var(--accent)] hover:underline">Help</Link>} />
      <DashboardShortcuts isAdmin={false} permissions={auth.data.permissions} />
    </div>;
  }
  const supabase = await createClient();
  const canViewStatements = auth.ok && (auth.data.roles.includes("admin") || Boolean(auth.data.permissions["bank.statements.view"]));
  const today = todayInIndia();

  const [
    summaryResult,
    balancesResult,
    { data: companies },
    { data: bankAccounts },
    { data: companyGroups },
    { data: banks },
    unmatchedResult,
    untaggedResult,
    draftResult,
    cashDifferenceResult,
    reconciliationResult,
  ] = await Promise.all([
    supabase.rpc("dashboard_daily_summary", { p_as_of: today }),
    supabase.rpc("dashboard_daily_balances", { p_as_of: today }),
    supabase.from("companies").select("id,code,name").eq("is_active", true).is("deleted_at", null).order("code"),
    supabase.from("bank_accounts").select("id,company_id,account_name,account_number").eq("is_active", true).is("deleted_at", null).order("account_name"),
    supabase.from("company_groups").select("id,code,name").eq("is_active", true).order("code"),
    supabase.from("banks").select("id,code,name").order("code"),
    canViewStatements
      ? supabase.from("bank_statement_lines").select("id", { count: "exact", head: true }).eq("match_status", "unmatched")
      : Promise.resolve({ count: 0, error: null }),
    canViewStatements
      ? supabase.from("bank_statement_lines").select("id", { count: "exact", head: true }).eq("match_status", "unmatched").is("suggested_party_id", null).is("counterparty_bank_account_id", null)
      : Promise.resolve({ count: 0, error: null }),
    supabase.from("vouchers").select("id", { count: "exact", head: true }).in("status", ["draft", "submitted", "approved"]),
    supabase.from("cash_verifications").select("id", { count: "exact", head: true }).neq("difference", 0),
    canViewStatements
      ? supabase.from("bank_reconciliations").select("id", { count: "exact", head: true }).eq("status", "open")
      : Promise.resolve({ count: 0, error: null }),
  ]);

  const summary = (summaryResult.data?.[0] ?? null) as DailySummary | null;
  const balances = (balancesResult.data ?? []) as DailyBalance[];
  const cashRows = balances
    .filter((row) => row.balance_kind === "cash")
    .sort((a, b) => `${a.company_code}-${a.entity_code}`.localeCompare(`${b.company_code}-${b.entity_code}`));
  const bankRows = balances
    .filter((row) => row.balance_kind === "bank")
    .sort((a, b) => `${a.company_code}-${a.entity_name}`.localeCompare(`${b.company_code}-${b.entity_name}`));
  const missingStatements = canViewStatements ? bankRows.filter((row) => !row.statement_current) : [];
  const unmatchedCount = unmatchedResult.count ?? 0;
  const untaggedCount = untaggedResult.count ?? 0;
  const draftCount = draftResult.count ?? 0;
  const cashDifferenceCount = cashDifferenceResult.count ?? 0;
  const reconciliationCount = reconciliationResult.count ?? 0;
  const dashboardError = summaryResult.error?.message ?? balancesResult.error?.message ?? null;

  const movementCards = [
    { label: "Cash in hand", hint: "Aaj cash kitna hai", value: summary?.cash_closing ?? 0 },
    { label: "Bank balance", hint: "Books ke hisaab se bank", value: summary?.bank_closing ?? 0 },
    { label: "Received today", hint: "Aaj paise aaye", value: summary?.total_receipts ?? 0 },
    { label: "Paid today", hint: "Aaj paise gaye", value: summary?.total_payments ?? 0 },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Aaj ki tasveer"
        description={`${displayDate(today)} — sirf posted entries. Badi numbers = abhi kitna cash aur bank hai.`}
        actions={
          <Link href="/help" className="rounded-md bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">
            Help
          </Link>
        }
      />

      {dashboardError ? (
        <Card className="border-[var(--danger)]">
          <p className="font-semibold text-[var(--danger)]">Daily dashboard database function is not available</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Apply migration 033, then reload this page. No estimated or invented balance is displayed.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {movementCards.map((item) => (
          <Card key={item.label}>
            <p className="text-sm text-[var(--muted)]">{item.hint}</p>
            <p className="mt-1 text-sm font-medium">{item.label}</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-3xl">
              {formatMoney(item.value)}
            </p>
          </Card>
        ))}
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Link href="/cash-book">
            <Card className={draftCount ? "border-amber-400" : ""}>
              <p className="text-sm text-[var(--muted)]">Work queue</p><p className="mt-1 font-semibold">Drafts / approvals</p><p className="mt-2 text-2xl font-semibold">{draftCount}</p><p className="mt-1 text-xs text-[var(--muted)]">Entries waiting to be posted</p>
            </Card>
          </Link>
          <Link href="/cash-book">
            <Card className={cashDifferenceCount ? "border-amber-400" : ""}>
              <p className="text-sm text-[var(--muted)]">Work queue</p><p className="mt-1 font-semibold">Cash differences</p><p className="mt-2 text-2xl font-semibold">{cashDifferenceCount}</p><p className="mt-1 text-xs text-[var(--muted)]">Physical count needs review</p>
            </Card>
          </Link>
      {canViewStatements ? <>
          <Link href="/bank-import">
            <Card className={missingStatements.length ? "border-amber-400" : ""}>
              <p className="text-sm text-[var(--muted)]">Aaj ka kaam</p>
              <p className="mt-1 font-semibold">Statements pending</p>
              <p className="mt-2 text-2xl font-semibold">{missingStatements.length}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Accounts jinka statement aaj tak nahi aaya</p>
            </Card>
          </Link>
          <Link href="/reports">
            <Card className={untaggedCount ? "border-amber-400" : ""}>
              <p className="text-sm text-[var(--muted)]">Aaj ka kaam</p>
              <p className="mt-1 font-semibold">Party nahi lagi</p>
              <p className="mt-2 text-2xl font-semibold">{untaggedCount}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Paid to / Received from khali hai</p>
            </Card>
          </Link>
          <Link href="/bank-import">
            <Card>
              <p className="text-sm text-[var(--muted)]">Aaj ka kaam</p>
              <p className="mt-1 font-semibold">Unmatched rows</p>
              <p className="mt-2 text-2xl font-semibold">{unmatchedCount}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Books se abhi match nahi hui</p>
            </Card>
          </Link>
          <Link href="/bank-import">
            <Card className={reconciliationCount ? "border-amber-400" : ""}>
              <p className="text-sm text-[var(--muted)]">Work queue</p><p className="mt-1 font-semibold">BRS open</p><p className="mt-2 text-2xl font-semibold">{reconciliationCount}</p><p className="mt-1 text-xs text-[var(--muted)]">Reconciliations with a difference</p>
            </Card>
          </Link>
      </> : null}
      </section>

      <DashboardShortcuts
        isAdmin={auth.data.roles.includes("admin")}
        permissions={auth.data.permissions}
      />

      {canViewStatements && missingStatements.length ? (
        <Card className="border-amber-500 bg-amber-50/50">
          <h2 className="text-lg font-semibold text-amber-900">
            {missingStatements.length} bank statement abhi pending
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            In accounts ka statement {displayDate(today)} tak nahi aaya. Neeche form se upload karo.
          </p>
          <ul className="mt-3 grid gap-2 text-sm text-amber-950 md:grid-cols-2">
            {missingStatements.map((row) => (
              <li key={row.entity_id} className="rounded border border-amber-300 bg-white/60 px-3 py-2">
                <strong>{row.company_code}</strong> — {row.entity_name}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canViewStatements ? (
        <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <summary className="cursor-pointer font-semibold">Bank statement upload</summary>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Company → Bank account → file. Import ke baad Paid to / Received from select karo.
          </p>
          <div className="mt-4">
            <StatementImportForm companies={companies ?? []} accounts={bankAccounts ?? []} groups={companyGroups ?? []} banks={banks ?? []} />
          </div>
        </details>
      ) : null}

      <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <summary className="cursor-pointer font-semibold">Cash detail — location wise</summary>
        <div className="mt-4 space-y-3">
          <p className="text-sm text-[var(--muted)]">Har cash counter ka opening, aaj aaya, aaj gaya, abhi closing.</p>
          <DataTable
            columns={["Company", "Cash location", "Opening", "Received", "Paid", "Current closing"]}
            rows={cashRows.map((row) => [
              row.company_code,
              `${row.entity_code} — ${row.entity_name}`,
              formatMoney(row.opening_balance),
              formatMoney(row.receipts),
              formatMoney(row.payments),
              formatMoney(row.closing_balance),
            ])}
          />
        </div>
      </details>

      <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <summary className="cursor-pointer font-semibold">Bank detail — account wise</summary>
        <div className="mt-4 space-y-3">
          <p className="text-sm text-[var(--muted)]">Book balance alag, uploaded statement alag. Difference reconcile ke liye hai.</p>
          <DataTable
            columns={canViewStatements ? ["Company", "Bank account", "Book opening", "Received", "Paid", "Book closing", "Statement opening", "Statement closing", "Difference", "Statement through"] : ["Company", "Bank account", "Book opening", "Received", "Paid", "Book closing"]}
            rows={bankRows.map((row) => canViewStatements ? [
              row.company_code,
              `${row.entity_name} ••••${row.entity_code}`,
              formatMoney(row.opening_balance),
              formatMoney(row.receipts),
              formatMoney(row.payments),
              formatMoney(row.closing_balance),
              row.statement_opening === null ? "—" : formatMoney(row.statement_opening),
              row.statement_closing === null ? "—" : formatMoney(row.statement_closing),
              row.statement_book_difference === null ? "—" : formatMoney(row.statement_book_difference),
              row.last_statement_to ? displayDate(row.last_statement_to) : "Never uploaded",
            ] : [row.company_code, row.entity_name, formatMoney(row.opening_balance), formatMoney(row.receipts), formatMoney(row.payments), formatMoney(row.closing_balance)])}
          />
        </div>
      </details>
    </div>
  );
}
