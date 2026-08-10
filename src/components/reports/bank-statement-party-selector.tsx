"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBankLineCounterparty } from "@/lib/actions/bank-import";
import { createParty } from "@/lib/actions/masters";
import { Button } from "@/components/ui/primitives";

type Party = { id: string; code: string; name: string };
type BankOption = { id: string; companyId: string; companyCode: string; accountName: string; accountNumber: string };

export function BankStatementPartySelector({
  lineId,
  groupId,
  direction,
  selectedPartyId,
  selectedBankAccountId,
  sourceBankAccountId,
  sourceCompanyId,
  parties,
  bankAccounts,
}: {
  lineId: string;
  groupId: string;
  direction: "received" | "paid";
  selectedPartyId: string | null;
  selectedBankAccountId: string | null;
  sourceBankAccountId: string;
  sourceCompanyId: string;
  parties: Party[];
  bankAccounts: BankOption[];
}) {
  const router = useRouter();
  const initialValue = selectedBankAccountId
    ? `bank:${selectedBankAccountId}`
    : selectedPartyId
      ? `party:${selectedPartyId}`
      : "";
  const [value, setValue] = useState(initialValue);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ownCompanyBanks = bankAccounts.filter((bank) => bank.companyId === sourceCompanyId && bank.id !== sourceBankAccountId);
  const groupCompanyBanks = bankAccounts.filter((bank) => bank.companyId !== sourceCompanyId);

  const assign = (selection: string) => startTransition(async () => {
    setError(null);
    const result = await setBankLineCounterparty(lineId, selection || undefined);
    if (!result.ok) { setError(result.error); return; }
    setValue(selection);
    router.refresh();
  });

  return <div className="w-full min-w-0 space-y-2">
    <select
      className="w-full min-w-0 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-xs"
      value={value}
      disabled={pending}
      aria-label={direction === "received" ? "Received from party or bank account" : "Paid to party or bank account"}
      onChange={(event) => {
        if (event.target.value === "__new") { setAdding(true); return; }
        setAdding(false);
        assign(event.target.value);
      }}
    >
      <option value="">{direction === "received" ? "Select received from" : "Select paid to"}</option>
      <optgroup label="Party Master">
        {parties.map((party) => <option key={party.id} value={`party:${party.id}`}>{party.code} — {party.name}</option>)}
      </optgroup>
      {ownCompanyBanks.length ? <optgroup label="Own company bank transfer (Contra)">
        {ownCompanyBanks.map((bank) => <option key={bank.id} value={`bank:${bank.id}`}>Own bank — {bank.accountName} ••••{bank.accountNumber.slice(-4)}</option>)}
      </optgroup> : null}
      {groupCompanyBanks.length ? <optgroup label="Group company bank transfer (Inter-company)">
        {groupCompanyBanks.map((bank) => <option key={bank.id} value={`bank:${bank.id}`}>{bank.companyCode} — {bank.accountName} ••••{bank.accountNumber.slice(-4)}</option>)}
      </optgroup> : null}
      <option value="__new">+ Add new party</option>
    </select>
    {adding ? <form className="space-y-2 rounded border border-[var(--border)] bg-[var(--background)] p-2" action={(formData) => startTransition(async () => {
      setError(null);
      const code = String(formData.get("code") ?? "").trim();
      const name = String(formData.get("name") ?? "").trim();
      const created = await createParty({ groupId, code, name, partyKinds: [direction === "received" ? "customer" : "supplier"], creditDays: 0 });
      if (!created.ok) { setError(created.error); return; }
      const selection = `party:${created.data.id}`;
      const assigned = await setBankLineCounterparty(lineId, selection);
      if (!assigned.ok) { setError(assigned.error); return; }
      setValue(selection);
      setAdding(false);
      router.refresh();
    })}>
      <input name="code" required maxLength={32} placeholder="Party code" className="w-full rounded border px-2 py-1 text-sm" />
      <input name="name" required maxLength={200} placeholder="Party name" className="w-full rounded border px-2 py-1 text-sm" />
      <div className="flex gap-2"><Button type="submit" disabled={pending}>Add & select</Button><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
    </form> : null}
    {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
  </div>;
}
