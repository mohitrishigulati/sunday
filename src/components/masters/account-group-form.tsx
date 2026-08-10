"use client";

import { useMemo, useState, useTransition } from "react";
import { createAccountGroup } from "@/lib/actions/masters";
import { Button, Input, Select } from "@/components/ui/primitives";

type Nature = "asset" | "liability" | "equity" | "income" | "expense";

type Group = {
  id: string;
  code: string;
  name: string;
  nature: string;
  company_id: string | null;
};

export function AccountGroupForm({
  companies,
  groups,
}: {
  companies: { id: string; code: string; name: string }[];
  groups: Group[];
}) {
  const [companyId, setCompanyId] = useState("");
  const [nature, setNature] = useState<Nature>("asset");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The DB requires a child's nature to match its parent, so only offer parents
  // that are actually selectable for the current company and nature.
  const parentOptions = useMemo(
    () => groups.filter((g) => g.company_id === companyId && g.nature === nature),
    [groups, companyId, nature],
  );

  return (
    <form
      className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2"
      action={(fd) => {
        startTransition(async () => {
          setError(null);
          const result = await createAccountGroup({
            companyId,
            code: String(fd.get("code")),
            name: String(fd.get("name")),
            nature,
            bsPlSection: String(fd.get("bsPlSection") || "") || undefined,
            cashFlowCategory: (String(fd.get("cashFlowCategory") || "") || undefined) as "operating" | "investing" | "financing" | "cash_equivalent" | undefined,
            workingCapitalClass: (String(fd.get("workingCapitalClass") || "") || undefined) as "current_asset" | "current_liability" | "non_current" | undefined,
            parentId: String(fd.get("parentId") || "") || undefined,
            isIntercompany: fd.get("isIntercompany") === "on",
          });
          if (!result.ok) setError(result.error);
        });
      }}
    >
      <Select
        label="Company"
        name="companyId"
        required
        value={companyId}
        onChange={(e) => setCompanyId(e.target.value)}
      >
        <option value="">Select</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} — {c.name}
          </option>
        ))}
      </Select>
      <Select
        label="Nature"
        name="nature"
        value={nature}
        onChange={(e) => setNature(e.target.value as Nature)}
      >
        <option value="asset">Asset</option>
        <option value="liability">Liability</option>
        <option value="equity">Equity</option>
        <option value="income">Income</option>
        <option value="expense">Expense</option>
      </Select>
      <Input label="Code" name="code" required placeholder="CA" />
      <Input label="Name" name="name" required placeholder="Current Assets" />
      <Select label="Parent group" name="parentId" disabled={!companyId}>
        <option value="">— top level —</option>
        {parentOptions.map((g) => (
          <option key={g.id} value={g.id}>
            {g.code} — {g.name}
          </option>
        ))}
      </Select>
      <Input
        label="BS / P&L section"
        name="bsPlSection"
        placeholder="Balance Sheet — Assets"
      />
      <Select label="Cash-flow category" name="cashFlowCategory"><option value="">Not classified</option><option value="operating">Operating</option><option value="investing">Investing</option><option value="financing">Financing</option><option value="cash_equivalent">Cash equivalent</option></Select>
      <Select label="Working-capital class" name="workingCapitalClass"><option value="">Not classified</option><option value="current_asset">Current asset</option><option value="current_liability">Current liability</option><option value="non_current">Non-current</option></Select>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input type="checkbox" name="isIntercompany" />
        Inter-company control group
      </label>
      {error ? <p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          Create account group
        </Button>
      </div>
    </form>
  );
}
