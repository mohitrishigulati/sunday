"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    label: "Daily work",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/cash-book", label: "Cash Entry / Cash Book" },
      { href: "/bank-book", label: "Bank Entry / Bank Book" },
      { href: "/bank-import", label: "Upload Bank Statement", permission: "bank.statements.view" },
      { href: "/journals", label: "Journal Entry (Debit / Credit)" },
      { href: "/business", label: "Sales & Purchase" },
      { href: "/intercompany", label: "Inter-company Transfer" },
      { href: "/payroll", label: "Salary Register" },
    ],
  },
  {
    label: "Reports & control",
    items: [
      { href: "/reports", label: "Accounting Reports", permission: "reports.company" },
      { href: "/consolidation", label: "Group Consolidation", permission: "reports.consolidated" },
      { href: "/controls", label: "Controls & Audit", permission: "periods.lock" },
    ],
  },
] as const;

export function SidebarNav({ roles, permissions }: { roles: string[]; permissions: Record<string, boolean> }) {
  const pathname = usePathname();
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
              const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
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
