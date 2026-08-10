"use client";

import { useState, useTransition } from "react";
import { createBankMaster } from "@/lib/actions/masters";
import { Button, Input } from "@/components/ui/primitives";

export function BankMasterForm() {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-3" action={(formData) => startTransition(async () => {
    setError(null); setMessage(null);
    const result = await createBankMaster({ code: String(formData.get("code")), name: String(formData.get("name")) });
    if (!result.ok) { setError(result.error); return; }
    setMessage("Bank name added. It is now available in bank-account selections.");
  })}>
    <Input label="Bank short code" name="code" required placeholder="YES" />
    <Input label="Bank name" name="name" required placeholder="Yes Bank Limited" />
    <div className="self-end"><Button type="submit" disabled={pending}>Add bank name</Button></div>
    {error ? <p className="text-sm text-[var(--danger)] md:col-span-3">{error}</p> : null}
    {message ? <p className="text-sm text-[var(--accent)] md:col-span-3">{message}</p> : null}
  </form>;
}
