"use client";

import Link from "next/link";
import { DISPLAY_REPORTS, type DisplayReportKey } from "@/lib/display-reports";

export function DisplayReportNav({ active }: { active: DisplayReportKey }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 print:hidden">
      {DISPLAY_REPORTS.map((item) => {
        const selected = active === item.key;
        return (
          <Link
            key={item.key}
            href={`/reports?r=${item.key}`}
            className={`rounded-lg border px-3 py-3 text-left transition ${
              selected
                ? "border-[var(--accent)] bg-[var(--surface-2)] font-semibold text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]"
            }`}
          >
            <p className="text-sm">{item.label}</p>
            <p className="mt-1 text-xs font-normal text-[var(--muted)]">{item.hint}</p>
          </Link>
        );
      })}
    </div>
  );
}
