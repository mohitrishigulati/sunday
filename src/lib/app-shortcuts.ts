export type AppShortcut = {
  href: string;
  key: string;
  label: string;
  hint: string;
  permission?: string;
};

export const APP_SHORTCUTS: AppShortcut[] = [
  { href: "/dashboard", key: "D", label: "Dashboard", hint: "Aaj ki tasveer" },
  { href: "/cash-book", key: "C", label: "Cash Book", hint: "Cash aaya / gaya" },
  { href: "/bank-book", key: "B", label: "Bank Book", hint: "Bank pay / receive" },
  { href: "/bank-import", key: "U", label: "Upload statement", hint: "PDF / Excel", permission: "bank.statements.view" },
  { href: "/journals", key: "J", label: "Journal", hint: "Debit / Credit" },
  { href: "/business", key: "S", label: "Sales & Purchase", hint: "Bill / invoice" },
  { href: "/intercompany", key: "I", label: "Inter-company", hint: "Group transfer" },
  { href: "/payroll", key: "Y", label: "Salary", hint: "Payroll entry" },
  { href: "/reports", key: "R", label: "Reports", hint: "Party ledger", permission: "reports.company" },
  { href: "/masters/parties", key: "P", label: "Party Master", hint: "Debtor / Creditor / Expense", permission: "masters.write" },
  { href: "/masters/companies", key: "M", label: "Company Master", hint: "Nayi company", permission: "masters.write" },
  { href: "/opening-balances", key: "O", label: "Opening balances", hint: "Saal ki shuruaat", permission: "masters.write" },
  { href: "/help", key: "H", label: "Help", hint: "Kaise use karein" },
];

export function visibleShortcuts(
  isAdmin: boolean,
  permissions: Record<string, boolean>,
) {
  return APP_SHORTCUTS.filter(
    (item) => !item.permission || isAdmin || permissions[item.permission],
  );
}
