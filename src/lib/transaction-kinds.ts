export const TRANSACTION_KINDS = [
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
  {
    kind: "contra",
    href: "/transactions/contra",
    label: "Contra",
    hint: "Cash ↔ bank transfer",
  },
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number]["kind"];
