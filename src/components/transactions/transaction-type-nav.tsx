"use client";

import Link from "next/link";
import { TRANSACTION_KINDS, type TransactionKind } from "@/lib/transaction-kinds";

export function TransactionTypeNav({ active }: { active?: TransactionKind }) {
  return (
    <div className="grid gap-2 sm:grid-cols-5">
      {TRANSACTION_KINDS.map((item) => {
        const selected = active === item.kind;
        return (
          <Link
            key={item.kind}
            href={item.href}
            className={`rounded-lg border px-3 py-3 text-center transition ${
              selected
                ? "border-[var(--accent)] bg-[var(--surface-2)] font-semibold text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]"
            }`}
          >
            <p className="text-sm">{item.label}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{item.hint}</p>
          </Link>
        );
      })}
    </div>
  );
}
