export const TRANSACTION_KINDS = [
  {
    kind: "sale",
    href: "/transactions/sale",
    label: "Sale",
    hint: "Sales invoice / bill",
  },
  {
    kind: "purchase",
    href: "/transactions/purchase",
    label: "Purchase",
    hint: "Purchase invoice / bill",
  },
  {
    kind: "receipt",
    href: "/transactions/receipt",
    label: "Receipt",
    hint: "Cash / bank received",
  },
  {
    kind: "payment",
    href: "/transactions/payment",
    label: "Payment",
    hint: "Cash / bank paid",
  },
  {
    kind: "journal",
    href: "/transactions/journal",
    label: "Journal Entry",
    hint: "Debit / Credit",
  },
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number]["kind"];
