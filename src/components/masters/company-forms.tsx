"use client";

import { useState, useTransition } from "react";
import {
  createCompany,
  createCompanyGroup,
} from "@/lib/actions/masters";
import { Button, Input } from "@/components/ui/primitives";

export function CompanyForms({
  groups,
}: {
  groups: { id: string; code: string; name: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        action={(fd) => {
          startTransition(async () => {
            setError(null);
            const result = await createCompanyGroup({
              code: String(fd.get("code")),
              name: String(fd.get("name")),
            });
            if (!result.ok) setError(result.error);
          });
        }}
      >
        <h2 className="font-medium">New company group</h2>
        <Input label="Code" name="code" required />
        <Input label="Name" name="name" required />
        <Button type="submit" disabled={pending}>
          Create group
        </Button>
      </form>

      <form
        className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        action={(fd) => {
          startTransition(async () => {
            setError(null);
            const result = await createCompany({
              groupId: String(fd.get("groupId")),
              code: String(fd.get("code")),
              name: String(fd.get("name")),
              legalName: String(fd.get("legalName") || "") || undefined,
              gstin: String(fd.get("gstin") || "") || undefined,
              stateCode: String(fd.get("stateCode") || "") || undefined,
              pan: String(fd.get("pan") || "") || undefined,
            });
            if (!result.ok) setError(result.error);
          });
        }}
      >
        <h2 className="font-medium">New company</h2>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Group</span>
          <select
            name="groupId"
            required
            className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2"
          >
            <option value="">Select group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} — {g.name}
              </option>
            ))}
          </select>
        </label>
        <Input label="Code" name="code" required placeholder="A" />
        <Input label="Name" name="name" required />
        <Input label="Legal name" name="legalName" />
        <Input label="GSTIN" name="gstin" />
        <Input label="State code" name="stateCode" maxLength={2} />
        <Input label="PAN" name="pan" />
        <Button type="submit" disabled={pending}>
          Create company
        </Button>
      </form>
      {error ? <p className="text-sm text-[var(--danger)] lg:col-span-2">{error}</p> : null}
    </div>
  );
}
