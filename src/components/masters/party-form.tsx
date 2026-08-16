"use client";

import { useState, useTransition } from "react";
import { createParty } from "@/lib/actions/masters";
import { Button, Input, Select } from "@/components/ui/primitives";

export function PartyForm({ groups }: { groups: { id: string; code: string; name: string }[] }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2" action={(formData) => {
      startTransition(async () => {
        setError(null);
        setMessage(null);
        const result = await createParty({
          groupId: String(formData.get("groupId")),
          code: String(formData.get("code")),
          name: String(formData.get("name")),
          partyKinds: formData.getAll("partyKinds").map(String) as ("customer" | "supplier" | "expense" | "employee" | "broker" | "agent")[],
          gstin: String(formData.get("gstin") || "") || undefined,
          stateCode: String(formData.get("stateCode") || "") || undefined,
          creditDays: Number(formData.get("creditDays") || 0),
        });
        if (!result.ok) setError(result.error);
        else setMessage("Party created. Now link it to one or more companies.");
      });
    }}>
      <h2 className="font-semibold md:col-span-2">Add receipt / payment party</h2>
      <p className="text-sm text-[var(--muted)] md:col-span-2">Choose the account header: Debtor (money to receive), Creditor (money to pay), or Expense (charges / GST / rent). Select more than one only if the same name is used in more than one way.</p>
      <Select label="Company group" name="groupId" required>
        <option value="">Select group</option>
        {groups.map((group) => <option key={group.id} value={group.id}>{group.code} — {group.name}</option>)}
      </Select>
      <Input label="Code" name="code" required />
      <Input label="Party name" name="name" required className="md:col-span-2" />
      <Input label="GSTIN" name="gstin" />
      <Input label="State code" name="stateCode" maxLength={2} />
      <Input label="Credit days" name="creditDays" type="number" min={0} max={3650} defaultValue={0} />
      <fieldset className="md:col-span-2">
        <legend className="mb-2 text-sm font-medium">Account header (select at least one)</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {[["customer", "Debtor"], ["supplier", "Creditor"], ["expense", "Expense"], ["employee", "Employee"], ["broker", "Broker"], ["agent", "Agent"]].map(([value, label]) => (
            <label key={value} className="flex items-center gap-2"><input type="checkbox" name="partyKinds" value={value} />{label}</label>
          ))}
        </div>
      </fieldset>
      {error ? <p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p> : null}
      {message ? <p className="text-sm text-[var(--accent)] md:col-span-2">{message}</p> : null}
      <div className="md:col-span-2"><Button type="submit" disabled={pending}>Add party</Button></div>
    </form>
  );
}
