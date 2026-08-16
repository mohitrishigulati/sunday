"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/primitives";
import { visibleShortcuts } from "@/lib/app-shortcuts";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function DashboardShortcuts({
  isAdmin,
  permissions,
}: {
  isAdmin: boolean;
  permissions: Record<string, boolean>;
}) {
  const router = useRouter();
  const items = visibleShortcuts(isAdmin, permissions);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;
      const match = items.find(
        (item) => item.key.toLowerCase() === event.key.toLowerCase(),
      );
      if (!match) return;
      event.preventDefault();
      router.push(match.href);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, router]);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Shortcuts</h2>
        <p className="text-sm text-[var(--muted)]">
          Click, letter key, ya <kbd className="rounded border border-[var(--border)] px-1">Ctrl</kbd>+<kbd className="rounded border border-[var(--border)] px-1">K</kbd> se search.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="block">
            <Card className="h-full transition hover:border-[var(--accent)]">
              <span className="inline-flex h-7 min-w-7 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 text-xs font-semibold">
                {item.key}
              </span>
              <p className="mt-3 font-semibold">{item.label}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{item.hint}</p>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
