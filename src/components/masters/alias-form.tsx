"use client";

import { useState, useTransition } from "react";
import { createPartyAlias } from "@/lib/actions/masters";
import { Button, Input, Select } from "@/components/ui/primitives";

export function AliasForm({
  parties,
}: {
  parties: { id: string; code: string; name: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2"
      action={(fd) => {
        startTransition(async () => {
          setError(null);
          const result = await createPartyAlias({
            partyId: String(fd.get("partyId")),
            aliasText: String(fd.get("aliasText")),
            confirmed: true,
          });
          if (!result.ok) setError(result.error);
        });
      }}
    >
      <Select label="Canonical party" name="partyId" required>
        <option value="">Select</option>
        {parties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} — {p.name}
          </option>
        ))}
      </Select>
      <Input label="Alias text" name="aliasText" required placeholder="X.Y.Z. Trading Co" />
      {error ? <p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          Save alias
        </Button>
      </div>
    </form>
  );
}
