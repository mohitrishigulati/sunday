"use client";

import { useMemo, useState, useTransition } from "react";
import { createLocation } from "@/lib/actions/masters";
import { Button, Input, Select } from "@/components/ui/primitives";

export function LocationForm({
  companies,
  cashLedgers,
}: {
  companies: { id: string; code: string; name: string }[];
  cashLedgers: { id: string; company_id: string; code: string; name: string }[];
}) {
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const companyCashLedgers = useMemo(
    () => cashLedgers.filter((ledger) => ledger.company_id === companyId),
    [cashLedgers, companyId],
  );

  return (
    <form
      className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2"
      action={(fd) => {
        startTransition(async () => {
          setError(null);
          const result = await createLocation({
            companyId,
            code: String(fd.get("code")),
            name: String(fd.get("name")),
            locationType: String(fd.get("locationType")) as
              | "branch"
              | "warehouse"
              | "cash_counter",
            isCashLocation: fd.get("isCashLocation") === "on",
            cashLedgerId: String(fd.get("cashLedgerId") || "") || undefined,
          });
          if (!result.ok) setError(result.error);
        });
      }}
    >
      <Select label="Company" name="companyId" required value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
        <option value="">Select</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} — {c.name}
          </option>
        ))}
      </Select>
      <Input label="Code" name="code" required placeholder="DEL" />
      <Input label="Name" name="name" required />
      <Select label="Type" name="locationType" required defaultValue="branch">
        <option value="branch">Branch</option>
        <option value="warehouse">Warehouse</option>
        <option value="cash_counter">Cash counter</option>
      </Select>
      <Select label="Cash ledger (optional)" name="cashLedgerId" disabled={!companyId}>
        <option value="">Auto-create a dedicated cash ledger</option>
        {companyCashLedgers.map((ledger) => (
          <option key={ledger.id} value={ledger.id}>
            {ledger.code} — {ledger.name}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input type="checkbox" name="isCashLocation" />
        Cash location (own cash book)
      </label>
      {error ? <p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          Create location
        </Button>
      </div>
    </form>
  );
}
