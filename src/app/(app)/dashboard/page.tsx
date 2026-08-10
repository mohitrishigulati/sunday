import Link from "next/link";
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
    const entryLinks = [
      ["Cash entry", "/cash-book", "Cash receipts and cash payments"],
      ["Bank entry", "/bank-book", "Bank receipts and bank payments"],
      ["Journal entry", "/journals", "Balanced debit and credit voucher"],
      ["Sales & purchase", "/business", "Customer and supplier documents"],
      ["Inter-company transfer", "/intercompany", "Linked transfer between group companies"],
      ["Salary entry", "/payroll", "Employee salary register entry"],
    ];
    return <div className="space-y-6">
      <PageHeader title="Entry workspace" description="You can prepare entries for assigned companies. Financial reports, statement data and downloads are restricted." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {entryLinks.map(([label, href, description]) => <Link key={href} href={href}><Card className="h-full transition hover:border-[var(--accent)]"><h2 className="font-semibold">{label}</h2><p className="mt-2 text-sm text-[var(--muted)]">{description}</p></Card></Link>)}
      </div>
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
  ] = await Promise.all([
    supabase.rpc("dashboard_daily_summary", { p_as_of: today }),
    supabase.rpc("dashboard_daily_balances", { p_as_of: today }),
    supabase.from("companies").select("id,code,name").eq("is_active", true).is("deleted_at", null).order("code"),
    supabase.from("bank_accounts").select("id,company_id,account_name,account_number").eq("is_active", true).is("deleted_at", null).order("account_name"),
    supabase.from("company_groups").select("id,code,name").eq("is_active", true).order("code"),
    supabase.from("banks").select("id,code,name").order("code"),
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
  const dashboardError = summaryResult.error?.message ?? balancesResult.error?.message ?? null;

  const movementCards = [
    { label: "Total opening — Cash + Bank", value: summary?.total_opening ?? 0 },
    { label: "Total closing — Cash + Bank", value: summary?.total_closing ?? 0 },
    { label: "Cash opening", value: summary?.cash_opening ?? 0 },
    { label: "Cash closing", value: summary?.cash_closing ?? 0 },
    { label: "Bank book opening", value: summary?.bank_opening ?? 0 },
    { label: "Bank book closing", value: summary?.bank_closing ?? 0 },
    { label: "Received today", value: summary?.total_receipts ?? 0 },
    { label: "Paid today", value: summary?.total_payments ?? 0 },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Daily financial movement"
        description={`${displayDate(today)} — posted books only. Closing is the current balance after today's posted entries.`}
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
            <p className="text-sm text-[var(--muted)]">{item.label}</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-3xl">
              {formatMoney(item.value)}
            </p>
          </Card>
        ))}
      </div>

      {canViewStatements && bankRows.some((row) => row.statement_closing !== null) ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold">Latest uploaded statement opening & closing</h2>
            <p className="text-sm text-[var(--muted)]">
              These are bank-statement balances. Bank book balances remain separately visible below for reconciliation.
            </p>
          </div>
          <DataTable
            columns={["Company", "Bank account", "Statement opening", "Statement closing", "Statement through", "Book difference"]}
            rows={bankRows
              .filter((row) => row.statement_closing !== null)
              .map((row) => [
                row.company_code,
                `${row.entity_name} ••••${row.entity_code}`,
                row.statement_opening === null ? "—" : formatMoney(row.statement_opening),
                formatMoney(row.statement_closing!),
                row.last_statement_to ? displayDate(row.last_statement_to) : "—",
                row.statement_book_difference === null ? "—" : formatMoney(row.statement_book_difference),
              ])}
          />
        </section>
      ) : null}

      {canViewStatements ? <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">Upload bank statement</h2>
          <p className="text-sm text-[var(--muted)]">
            Select company, select bank account, then upload the PDF or Excel statement. Dashboard balances and statement status refresh after import.
          </p>
        </div>
        <StatementImportForm companies={companies ?? []} accounts={bankAccounts ?? []} groups={companyGroups ?? []} banks={banks ?? []} />
      </section> : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Cash balance today</h2>
            <p className="text-sm text-[var(--muted)]">Every location has its own opening, movement and current closing.</p>
          </div>
          <div className="flex gap-3 text-sm">
            <span>Opening <strong>{formatMoney(summary?.cash_opening ?? 0)}</strong></span>
            <span>Closing <strong>{formatMoney(summary?.cash_closing ?? 0)}</strong></span>
          </div>
        </div>
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
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Bank balance today</h2>
            <p className="text-sm text-[var(--muted)]">Book balance and latest uploaded statement balance remain separate and reconcilable.</p>
          </div>
          <div className="flex gap-3 text-sm">
            <span>Opening <strong>{formatMoney(summary?.bank_opening ?? 0)}</strong></span>
            <span>Closing <strong>{formatMoney(summary?.bank_closing ?? 0)}</strong></span>
          </div>
        </div>
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
      </section>

      {canViewStatements ? <section>
        {missingStatements.length ? (
          <Card className="border-amber-500 bg-amber-50/50">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-amber-900">
                  Bank statements pending: {missingStatements.length}
                </h2>
                <p className="mt-1 text-sm text-amber-800">
                  These active accounts do not have an uploaded statement covering {displayDate(today)}.
                </p>
              </div>
              <span className="text-sm font-semibold text-amber-900">Upload using the form above</span>
            </div>
            <ul className="mt-4 grid gap-2 text-sm text-amber-950 md:grid-cols-2">
              {missingStatements.map((row) => (
                <li key={row.entity_id} className="rounded border border-amber-300 bg-white/60 px-3 py-2">
                  <strong>{row.company_code}</strong> — {row.entity_name} ••••{row.entity_code}
                  <span className="block text-xs text-amber-800">
                    {row.last_statement_to ? `Last statement through ${displayDate(row.last_statement_to)}` : "No statement uploaded"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : !dashboardError ? (
          <Card className="border-emerald-500 bg-emerald-50/50">
            <h2 className="font-semibold text-emerald-900">All bank statements are current through today</h2>
          </Card>
        ) : null}
      </section> : null}

    </div>
  );
}
