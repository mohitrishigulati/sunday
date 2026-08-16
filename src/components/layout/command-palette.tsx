"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { visibleShortcuts } from "@/lib/app-shortcuts";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function CommandPalette({
  isAdmin,
  permissions,
}: {
  isAdmin: boolean;
  permissions: Record<string, boolean>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const items = useMemo(
    () => visibleShortcuts(isAdmin, permissions),
    [isAdmin, permissions],
  );
  const filtered = items.filter((item) => {
    const hay = `${item.label} ${item.hint} ${item.key}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery("");
        return;
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        className="hidden rounded-md border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--muted)] hover:text-[var(--ink)] md:inline"
        onClick={() => {
          setOpen(true);
          setQuery("");
        }}
      >
        Search · Ctrl+K
      </button>
      {open ? (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search: cash, bank, party, reports…"
          className="w-full border-b border-[var(--border)] px-4 py-3 text-sm outline-none"
          onKeyDown={(event) => {
            if (event.key === "Enter" && filtered[0]) {
              router.push(filtered[0].href);
              setOpen(false);
            }
          }}
        />
        <ul className="max-h-80 overflow-y-auto p-2">
          {filtered.length ? (
            filtered.map((item) => (
              <li key={item.href}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]"
                  onClick={() => {
                    router.push(item.href);
                    setOpen(false);
                  }}
                >
                  <span>
                    <span className="font-medium">{item.label}</span>
                    <span className="ml-2 text-[var(--muted)]">{item.hint}</span>
                  </span>
                  <kbd className="rounded border border-[var(--border)] px-1.5 text-xs">{item.key}</kbd>
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-4 text-sm text-[var(--muted)]">Kuch nahi mila</li>
          )}
        </ul>
        <p className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
          Ctrl+K se search. Enter se pehla result.
        </p>
      </div>
    </div>
      ) : null}
    </>
  );
}
