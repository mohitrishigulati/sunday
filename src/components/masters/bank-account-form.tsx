"use client";

import { useMemo, useState, useTransition } from "react";
import { createBankAccount } from "@/lib/actions/masters";
import { BusyHeadSelect } from "@/components/masters/busy-head-select";
import { Button, Input, Select } from "@/components/ui/primitives";

export function BankAccountForm({
  companies,
  banks,
  accountGroups,
}: {
  companies: { id: string; code: string; name: string }[];
  banks: { id: string; code: string; name: string }[];
  accountGroups: { id: string; company_id: string | null; code: string; name: string; nature: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [companyId, setCompanyId] = useState("");
  const [accountGroupId, setAccountGroupId] = useState("");
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
          const accountType = String(fd.get("accountType") || "");
          const result = await createBankAccount({
            companyId: String(fd.get("companyId")),
            bankId: String(fd.get("bankId") || "") || undefined,
            accountName: String(fd.get("accountName")),
            accountNumber: String(fd.get("accountNumber")),
            ifsc: String(fd.get("ifsc") || "") || undefined,
            accountType: accountType
              ? (accountType as "current" | "savings" | "od" | "cc")
              : undefined,
            ledgerCode: String(fd.get("ledgerCode")),
            ledgerName: String(fd.get("ledgerName")),
            accountGroupId: String(fd.get("accountGroupId") || "") || undefined,
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
        onChange={(event) => {
          const next = event.target.value;
          setCompanyId(next);
          const bankHead = accountGroups.find((group) => group.company_id === next && group.code === "BS-BANK");
          setAccountGroupId(bankHead?.id ?? "");
        }}
      >
        <option value="">Select</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} — {c.name}
          </option>
        ))}
      </Select>
      <Select label="Bank" name="bankId">
        <option value="">Optional</option>
        {banks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code} — {b.name}
          </option>
        ))}
      </Select>
      <Input label="Account name" name="accountName" required />
      <Input label="Account number" name="accountNumber" required />
      <Input label="IFSC" name="ifsc" />
      <Select label="Account type" name="accountType" defaultValue="current">
        <option value="current">Current</option>
        <option value="savings">Savings</option>
        <option value="od">OD</option>
        <option value="cc">CC</option>
      </Select>
      <Input label="Ledger code" name="ledgerCode" required placeholder="BANK-HDFC-01" />
      <Input label="Ledger name" name="ledgerName" required />
      <BusyHeadSelect
        label="Under account head"
        name="accountGroupId"
        required
        disabled={!companyId}
        value={accountGroupId}
        onChange={setAccountGroupId}
        heads={companyHeads.map((group) => ({
          id: group.id,
          code: group.code,
          name: group.name,
          nature: group.nature,
        }))}
        placeholder={companyId ? "Bank Accounts / Cash-in-hand / Current Assets" : "Select company first"}
      />
      {error ? <p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          Create bank account
        </Button>
      </div>
    </form>
  );
}
