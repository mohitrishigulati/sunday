import { TransactionTypeNav } from "@/components/transactions/transaction-type-nav";
import { PageHeader } from "@/components/ui/primitives";
import { TRANSACTION_KINDS } from "@/lib/transaction-kinds";
import Link from "next/link";

export default function TransactionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="Sale, Purchase, Receipt, Payment aur Journal Entry — Busy jaisa voucher type choose karo."
      />
      <TransactionTypeNav />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {TRANSACTION_KINDS.map((item) => (
          <Link
            key={item.kind}
            href={item.href}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--accent)]"
          >
            <p className="text-lg font-semibold">{item.label}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">{item.hint}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
