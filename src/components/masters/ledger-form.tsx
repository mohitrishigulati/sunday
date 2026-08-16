"use client";

import { useMemo, useState, useTransition } from "react";
import { createLedger } from "@/lib/actions/masters";
import { BusyHeadSelect } from "@/components/masters/busy-head-select";
import { Button, Input, Select } from "@/components/ui/primitives";

type LedgerType =
  | "general"
  | "cash"
  | "bank"
  | "party"
  | "intercompany_receivable"
  | "intercompany_payable"
  | "intercompany_income"
  | "intercompany_expense";

export function LedgerForm({
  companies,
  accountGroups,
}: {
  companies: { id: string; code: string; name: string }[];
  accountGroups: {
    id: string;
    code: string;
    name: string;
    nature: string;
    company_id: string | null;
  }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [ledgerType, setLedgerType] = useState<LedgerType>("general");
  const [pending, startTransition] = useTransition();

  const isIc = ledgerType.startsWith("intercompany_");

  // A ledger may only be filed under a group in its own company.
  const companyGroups = useMemo(
    () => accountGroups.filter((g) => g.company_id === companyId),
    [accountGroups, companyId],
  );

  return (
    <form
      className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2"
      action={(fd) => {
        startTransition(async () => {
          setError(null);
          const result = await createLedger({
            companyId,
            code: String(fd.get("code")),
            name: String(fd.get("name")),
            ledgerType,
            accountGroupId: String(fd.get("accountGroupId") || "") || undefined,
            counterpartCompanyId: isIc
              ? String(fd.get("counterpartCompanyId") || "") || undefined
              : undefined,
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
        label="Ledger type"
        name="ledgerType"
        value={ledgerType}
        onChange={(e) => setLedgerType(e.target.value as LedgerType)}
      >
        <option value="general">General</option>
        <option value="cash">Cash</option>
        <option value="bank">Bank</option>
        <option value="party">Party</option>
        <option value="intercompany_receivable">IC receivable</option>
        <option value="intercompany_payable">IC payable</option>
        <option value="intercompany_income">IC income</option>
        <option value="intercompany_expense">IC expense</option>
      </Select>
      <Input label="Code" name="code" required />
      <Input label="Name" name="name" required />
      <BusyHeadSelect
        label="Account group"
        name="accountGroupId"
        disabled={!companyId}
        heads={companyGroups.map((g) => ({
          id: g.id,
          code: g.code,
          name: g.name,
          nature: g.nature,
        }))}
        placeholder={companyId ? "Cash-in-hand / Bank Accounts / Current Assets" : "Select a company first"}
      />
      <Select
        label="Counterpart company"
        name="counterpartCompanyId"
        required={isIc}
        disabled={!isIc}
      >
        <option value="">{isIc ? "Select" : "Inter-company types only"}</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} — {c.name}
          </option>
        ))}
      </Select>
      {error ? <p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          Create ledger
        </Button>
      </div>
    </form>
  );
}
