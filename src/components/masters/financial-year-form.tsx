"use client";

import { useState, useTransition } from "react";
import { createFinancialYear } from "@/lib/actions/masters";
import { Button, Input, Select } from "@/components/ui/primitives";

export function FinancialYearForm({
  companies,
}: {
  companies: { id: string; code: string; name: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2"
      action={(fd) => {
        startTransition(async () => {
          setError(null);
          const result = await createFinancialYear({
            companyId: String(fd.get("companyId")),
            code: String(fd.get("code")),
            startDate: String(fd.get("startDate")),
            endDate: String(fd.get("endDate")),
          });
          if (!result.ok) setError(result.error);
        });
      }}
    >
      <Select label="Company" name="companyId" required>
        <option value="">Select</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} — {c.name}
          </option>
        ))}
      </Select>
      <Input label="FY code" name="code" required placeholder="2025-26" />
      <Input label="Start date" name="startDate" type="date" required />
      <Input label="End date" name="endDate" type="date" required />
      {error ? <p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          Create FY + monthly periods
        </Button>
      </div>
    </form>
  );
}
