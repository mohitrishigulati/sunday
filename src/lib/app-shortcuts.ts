export type AppShortcut = {
  href: string;
  key: string;
  label: string;
  hint: string;
  permission?: string;
};

export const APP_SHORTCUTS: AppShortcut[] = [
  { href: "/dashboard", key: "D", label: "Dashboard", hint: "Aaj ki tasveer" },
  { href: "/transactions", key: "T", label: "Transactions", hint: "Receipt / Payment / Journal / Contra" },
  { href: "/transactions/receipt", key: "E", label: "Receipt", hint: "Cash / bank received" },
  { href: "/transactions/payment", key: "Y", label: "Payment", hint: "Cash / bank paid" },
  { href: "/transactions/journal", key: "J", label: "Journal Entry", hint: "Debit / Credit" },
  { href: "/transactions/contra", key: "N", label: "Contra", hint: "Cash ↔ bank transfer" },
  { href: "/cash-book", key: "C", label: "Cash Book", hint: "Cash register" },
  { href: "/bank-book", key: "B", label: "Bank Book", hint: "Bank register" },
  { href: "/bank-import", key: "U", label: "Upload statement", hint: "PDF / Excel", permission: "bank.statements.view" },
  { href: "/intercompany", key: "I", label: "Inter-company", hint: "Group transfer" },
  { href: "/reports?r=trial", key: "R", label: "Display", hint: "Trial / Day Book / Ledger / Balance Sheet", permission: "reports.company" },
  { href: "/masters/parties", key: "A", label: "Party Master", hint: "Debtor / Creditor / Expense", permission: "masters.write" },
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
