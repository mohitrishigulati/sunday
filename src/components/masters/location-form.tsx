"use client";

import { useMemo, useState, useTransition } from "react";
import { createLocation } from "@/lib/actions/masters";
import { BusyHeadSelect } from "@/components/masters/busy-head-select";
import { Button, Input, Select } from "@/components/ui/primitives";

export function LocationForm({
  companies,
  cashLedgers,
  accountGroups,
}: {
  companies: { id: string; code: string; name: string }[];
  cashLedgers: { id: string; company_id: string; code: string; name: string }[];
  accountGroups: { id: string; company_id: string | null; code: string; name: string; nature: string }[];
}) {
  const [companyId, setCompanyId] = useState("");
  const [cashAccountGroupId, setCashAccountGroupId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const companyCashLedgers = useMemo(
    () => cashLedgers.filter((ledger) => ledger.company_id === companyId),
    [cashLedgers, companyId],
  );
  const companyHeads = useMemo(
    () => accountGroups.filter((group) => group.company_id === companyId),
    [accountGroups, companyId],
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
            cashAccountGroupId: String(fd.get("cashAccountGroupId") || "") || undefined,
          });
          if (!result.ok) setError(result.error);
        });
      }}
    >
      <Select label="Company" name="companyId" required value={companyId} onChange={(event) => {
        const next = event.target.value;
        setCompanyId(next);
        const cashHead = accountGroups.find((group) => group.company_id === next && group.code === "BS-CASH");
        setCashAccountGroupId(cashHead?.id ?? "");
      }}>
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
      <BusyHeadSelect
        label="New cash ledger under"
        name="cashAccountGroupId"
        disabled={!companyId}
        value={cashAccountGroupId}
        onChange={setCashAccountGroupId}
        heads={companyHeads.map((group) => ({
          id: group.id,
          code: group.code,
          name: group.name,
          nature: group.nature,
        }))}
        placeholder={companyId ? "Cash-in-hand / Current Assets / Bank Accounts" : "Select company first"}
      />
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
