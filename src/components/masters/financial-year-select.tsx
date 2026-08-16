"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ensureAprilMarchYears } from "@/lib/actions/masters";
import { aprilMarchYearLabel } from "@/lib/financial-year";
import { Button, Select } from "@/components/ui/primitives";

export type FinancialYearOption = {
  id: string;
  company_id: string;
  code: string;
  start_date?: string;
  end_date?: string;
};

export function FinancialYearSelect({
  companyId,
  years,
  name = "financialYearId",
  value,
  required,
  disabled,
  emptyLabel = "Select April–March year",
  onChange,
  onEnsured,
}: {
  companyId: string;
  years: FinancialYearOption[];
  name?: string;
  value?: string;
  required?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
  onChange?: (id: string) => void;
  onEnsured?: (years: FinancialYearOption[], currentId: string) => void;
}) {
  const [extra, setExtra] = useState<FinancialYearOption[]>([]);
  const [internal, setInternal] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const merged = useMemo(() => {
    const byId = new Map<string, FinancialYearOption>();
    for (const year of [...years, ...extra]) {
      if (!companyId || year.company_id === companyId) byId.set(year.id, year);
    }
    return [...byId.values()].sort((a, b) => (b.start_date ?? b.code).localeCompare(a.start_date ?? a.code));
  }, [years, extra, companyId]);
  const selected = value ?? internal;

  function pick(id: string) {
    setInternal(id);
    onChange?.(id);
  }

  function ensureYears() {
    if (!companyId) return;
    startTransition(async () => {
      setError(null);
      const result = await ensureAprilMarchYears(companyId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setExtra(result.data.years);
      onEnsured?.(result.data.years, result.data.currentId);
      if (!selected && result.data.currentId) pick(result.data.currentId);
    });
  }

  useEffect(() => {
    setInternal("");
    if (!companyId) return;
    ensureYears();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  return (
    <div className="space-y-1">
      <Select
        label="Financial year (April–March)"
        name={name}
        required={required}
        disabled={disabled || !companyId || pending}
        value={selected}
        onChange={(event) => pick(event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {merged.map((year) => (
          <option key={year.id} value={year.id}>
            {aprilMarchYearLabel(year)}
          </option>
        ))}
      </Select>
      <Button type="button" variant="ghost" disabled={pending || !companyId} onClick={ensureYears}>
        + Add April–March years
      </Button>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
