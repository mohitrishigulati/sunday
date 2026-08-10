"use client";

import { useMemo, useState, useTransition } from "react";
import { linkPartyToCompany } from "@/lib/actions/masters";
import { Button, Input, Select } from "@/components/ui/primitives";

type Company = { id: string; code: string; name: string };
type Party = { id: string; code: string; name: string };
type Ledger = { id: string; company_id: string; party_id: string | null; code: string; name: string };

export function PartyCompanyLinkForm({ companies, parties, ledgers }: { companies: Company[]; parties: Party[]; ledgers: Ledger[] }) {
  const [companyId, setCompanyId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matchingLedgers = useMemo(() => ledgers.filter((ledger) => ledger.company_id === companyId && ledger.party_id === partyId), [companyId, partyId, ledgers]);

  return (
    <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2" action={(formData) => {
      startTransition(async () => {
        setError(null);
        setMessage(null);
        const result = await linkPartyToCompany({
          partyId: String(formData.get("partyId")), companyId: String(formData.get("companyId")), ledgerId: String(formData.get("ledgerId")),
          creditLimit: formData.get("creditLimit") ? Number(formData.get("creditLimit")) : undefined,
        });
        if (!result.ok) setError(result.error);
        else setMessage("Party linked to company successfully.");
      });
    }}>
      <h2 className="font-semibold md:col-span-2">Link party to company</h2>
      <p className="text-sm text-[var(--muted)] md:col-span-2">The same party can work with many group companies. Select its separate ledger for every company.</p>
      <Select label="Party" name="partyId" required value={partyId} onChange={(event) => setPartyId(event.target.value)}>
        <option value="">Select party</option>{parties.map((party) => <option key={party.id} value={party.id}>{party.code} — {party.name}</option>)}
      </Select>
      <Select label="Company" name="companyId" required value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
        <option value="">Select company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.code} — {company.name}</option>)}
      </Select>
      <Select label="Party ledger" name="ledgerId" required disabled={!companyId || !partyId}>
        <option value="">{matchingLedgers.length ? "Select ledger" : "Create this party's ledger for this company first"}</option>
        {matchingLedgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.code} — {ledger.name}</option>)}
      </Select>
      <Input label="Credit limit" name="creditLimit" type="number" min="0" step="0.0001" />
      {error ? <p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p> : null}
      {message ? <p className="text-sm text-[var(--accent)] md:col-span-2">{message}</p> : null}
      <div className="md:col-span-2"><Button type="submit" disabled={pending || matchingLedgers.length === 0}>Save company link</Button></div>
    </form>
  );
}
