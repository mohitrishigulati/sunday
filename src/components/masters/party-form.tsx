"use client";

import { useMemo, useState, useTransition } from "react";
import { createParty } from "@/lib/actions/masters";
import { BusyHeadSelect } from "@/components/masters/busy-head-select";
import { defaultPartyHeadCode } from "@/lib/busy-account-groups";
import { Button, Input, Select } from "@/components/ui/primitives";

type Kind = "customer" | "supplier" | "expense" | "employee" | "broker" | "agent";

export function PartyForm({
  groups,
  companies,
  accountGroups,
}: {
  groups: { id: string; code: string; name: string }[];
  companies: { id: string; group_id: string; code: string; name: string }[];
  accountGroups: { id: string; company_id: string | null; code: string; name: string; nature: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [groupId, setGroupId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [accountGroupId, setAccountGroupId] = useState("");
  const [kinds, setKinds] = useState<Kind[]>([]);

  const groupCompanies = useMemo(
    () => companies.filter((company) => company.group_id === groupId),
    [companies, groupId],
  );
  const companyHeads = useMemo(
    () =>
      accountGroups.filter((group) => group.company_id === companyId),
    [accountGroups, companyId],
  );

  function applyKinds(next: Kind, checked: boolean) {
    const selected = checked ? [...kinds, next] : kinds.filter((kind) => kind !== next);
    setKinds(selected);
    if (!companyId) return;
    const preferred = defaultPartyHeadCode(selected);
    const match = companyHeads.find((group) => group.code === preferred);
    if (match) setAccountGroupId(match.id);
  }

  return (
    <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2" action={(formData) => {
      startTransition(async () => {
        setError(null);
        setMessage(null);
        const result = await createParty({
          groupId: String(formData.get("groupId")),
          code: String(formData.get("code")),
          name: String(formData.get("name")),
          partyKinds: formData.getAll("partyKinds").map(String) as Kind[],
          gstin: String(formData.get("gstin") || "") || undefined,
          stateCode: String(formData.get("stateCode") || "") || undefined,
          creditDays: Number(formData.get("creditDays") || 0),
          companyId: String(formData.get("companyId") || "") || undefined,
          accountGroupId: String(formData.get("accountGroupId") || "") || undefined,
        });
        if (!result.ok) setError(result.error);
        else setMessage("Party created under the selected account head.");
      });
    }}>
      <h2 className="font-semibold md:col-span-2">Add receipt / payment party</h2>
      <p className="text-sm text-[var(--muted)] md:col-span-2">
        Company choose karo, phir ye party kis head pe jaye: Cash-in-hand, Bank Accounts, Current Assets, Sundry Debtors / Creditors.
      </p>
      <Select label="Company group" name="groupId" required value={groupId} onChange={(event) => { setGroupId(event.target.value); setCompanyId(""); setAccountGroupId(""); }}>
        <option value="">Select group</option>
        {groups.map((group) => <option key={group.id} value={group.id}>{group.code} — {group.name}</option>)}
      </Select>
      <Select label="Company" name="companyId" required value={companyId} onChange={(event) => {
        const next = event.target.value;
        setCompanyId(next);
        const preferred = defaultPartyHeadCode(kinds);
        const match =
          accountGroups.find((group) => group.company_id === next && group.code === preferred) ??
          accountGroups.find((group) => group.company_id === next && group.code === "BS-CA");
        setAccountGroupId(match?.id ?? "");
      }} disabled={!groupId}>
        <option value="">{groupId ? "Select company" : "Select company group first"}</option>
        {groupCompanies.map((company) => <option key={company.id} value={company.id}>{company.code} — {company.name}</option>)}
      </Select>
      <Input label="Code" name="code" required />
      <Input label="Party name" name="name" required />
      <Input label="GSTIN" name="gstin" />
      <Input label="State code" name="stateCode" maxLength={2} />
      <Input label="Credit days" name="creditDays" type="number" min={0} max={3650} defaultValue={0} />
      <BusyHeadSelect
        label="Under account head"
        name="accountGroupId"
        required={companyHeads.length > 0}
        disabled={!companyId}
        value={accountGroupId}
        onChange={setAccountGroupId}
        heads={companyHeads.map((group) => ({ id: group.id, code: group.code, name: group.name, nature: group.nature }))}
        placeholder={companyId ? (companyHeads.length ? "Select head" : "Add Busy heads on this company first") : "Select company first"}
      />
      <fieldset className="md:col-span-2">
        <legend className="mb-2 text-sm font-medium">Account header (select at least one)</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {([["customer", "Debtor"], ["supplier", "Creditor"], ["expense", "Expense"], ["employee", "Employee"], ["broker", "Broker"], ["agent", "Agent"]] as const).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="checkbox" name="partyKinds" value={value} checked={kinds.includes(value)} onChange={(event) => applyKinds(value, event.target.checked)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {error ? <p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p> : null}
      {message ? <p className="text-sm text-[var(--accent)] md:col-span-2">{message}</p> : null}
      <div className="md:col-span-2"><Button type="submit" disabled={pending}>Add party</Button></div>
    </form>
  );
}
