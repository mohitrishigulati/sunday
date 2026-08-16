"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const GROUPS = [
  {
    label: "Masters",
    items: [
      { href: "/masters/companies", label: "1. Company Master", permission: "masters.write" },
      { href: "/masters/parties", label: "2. Party Master (Money In / Out)", permission: "masters.write" },
      { href: "/masters/expense-heads", label: "3. Expense Head Master", permission: "masters.write" },
      { href: "/masters/locations", label: "Location / Cash Counter Master", permission: "masters.write" },
      { href: "/masters/bank-accounts", label: "Bank Account Master", permission: "masters.write" },
      { href: "/masters/account-groups", label: "Account Group Master", permission: "masters.write" },
      { href: "/masters/ledgers", label: "Ledger Master", permission: "masters.write" },
      { href: "/masters/aliases", label: "Party Alias Master", permission: "masters.write" },
      { href: "/masters/dimensions", label: "Other Accounting Masters", permission: "masters.write" },
      { href: "/masters/financial-years", label: "Financial Year Master", permission: "masters.write" },
      { href: "/opening-balances", label: "Opening Balances", permission: "masters.write" },
      { href: "/masters/users", label: "Users & Access", permission: "users.manage" },
    ],
  },
  {
    label: "Transactions",
    items: [
      { href: "/transactions", label: "Voucher types" },
      { href: "/transactions/receipt", label: "Receipt" },
      { href: "/transactions/payment", label: "Payment" },
      { href: "/transactions/journal", label: "Journal Entry" },
      { href: "/transactions/contra", label: "Contra (Cash ↔ Bank)" },
    ],
  },
  {
    label: "Daily work",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/help", label: "Help" },
      { href: "/cash-book", label: "Cash Book" },
      { href: "/bank-book", label: "Bank Book" },
      { href: "/bank-import", label: "Upload Bank Statement", permission: "bank.statements.view" },
      { href: "/intercompany", label: "Inter-company Transfer" },
      { href: "/payroll", label: "Salary Register" },
    ],
  },
  {
    label: "Display",
    items: [
      { href: "/reports?r=day", label: "Day Book", permission: "reports.company" },
      { href: "/reports?r=cash", label: "Cash Ledger", permission: "reports.company" },
      { href: "/reports?r=bank", label: "Bank Ledger", permission: "reports.company" },
      { href: "/reports?r=ledger", label: "Account Ledger", permission: "reports.company" },
      { href: "/reports?r=party", label: "Party Ledger", permission: "reports.company" },
      { href: "/reports?r=trial", label: "Trial Balance", permission: "reports.company" },
      { href: "/reports?r=trading", label: "Trading Account", permission: "reports.company" },
      { href: "/reports?r=pnl", label: "Profit & Loss", permission: "reports.company" },
      { href: "/reports?r=balance", label: "Balance Sheet", permission: "reports.company" },
      { href: "/reports?r=sales", label: "Sales Register", permission: "reports.company" },
      { href: "/reports?r=purchase", label: "Purchase Register", permission: "reports.company" },
      { href: "/reports?r=outstanding", label: "Outstanding", permission: "reports.company" },
      { href: "/reports?r=expense", label: "Expense Head-wise", permission: "reports.company" },
      { href: "/reports?r=cashflow", label: "Cash Flow", permission: "reports.company" },
    ],
  },
  {
    label: "Reports & control",
    items: [
      { href: "/consolidation", label: "Group Consolidation", permission: "reports.consolidated" },
      { href: "/controls", label: "Controls & Audit", permission: "periods.lock" },
    ],
  },
] as const;

export function SidebarNav({ roles, permissions }: { roles: string[]; permissions: Record<string, boolean> }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reportKey = searchParams.get("r");
  const isAdmin = roles.includes("admin");
  return (
    <nav className="space-y-6" aria-label="Main navigation">
      {GROUPS.map((group) => {
        const items = group.items.filter((item) => !("permission" in item) || isAdmin || permissions[item.permission]);
        if (!items.length) return null;
        return (
        <section key={group.label}>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{group.label}</p>
          <div className="space-y-1">
            {items.map((item) => {
              const reportMatch = item.href.startsWith("/reports?r=");
              const itemReport = reportMatch ? item.href.split("r=")[1] : null;
              const active = reportMatch
                ? pathname === "/reports" && (reportKey ?? "trial") === itemReport
                : pathname === item.href || (item.href !== "/dashboard" && item.href !== "/transactions" && pathname.startsWith(`${item.href}/`));
              return (
                <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`block rounded-md border-l-2 px-3 py-2 text-sm transition ${active ? "border-[var(--accent)] bg-[var(--surface-2)] font-semibold text-[var(--accent)]" : "border-transparent text-[var(--ink)] hover:bg-[var(--surface-2)]"}`}>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </section>
      );})}
    </nav>
  );
}
