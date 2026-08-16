"use client";

import { useMemo, useState, useTransition } from "react";
import { createContraEntry } from "@/lib/actions/daily-entries";
import { Button, Input, Select } from "@/components/ui/primitives";

type Company = { id: string; code: string; name: string };
type Location = { id: string; company_id: string; code: string; name: string };
type Year = { id: string; company_id: string; code: string };
type Bank = { id: string; company_id: string; account_name: string; account_number: string };

export function ContraEntryForm({ companies, locations, years, accounts }: { companies: Company[]; locations: Location[]; years: Year[]; accounts: Bank[] }) {
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const companyLocations = useMemo(() => locations.filter((row) => row.company_id === companyId), [locations, companyId]);
  const companyYears = useMemo(() => years.filter((row) => row.company_id === companyId), [years, companyId]);
  const companyAccounts = useMemo(() => accounts.filter((row) => row.company_id === companyId), [accounts, companyId]);

  return <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-4" action={(formData) => startTransition(async () => {
    setError(null); setMessage(null);
    const result = await createContraEntry({
      companyId, financialYearId: String(formData.get("financialYearId")), cashLocationId: String(formData.get("cashLocationId")), bankAccountId: String(formData.get("bankAccountId")),
      voucherDate: String(formData.get("voucherDate")), direction: String(formData.get("direction")) as "cash_to_bank" | "bank_to_cash", amount: Number(formData.get("amount")),
      reference: String(formData.get("reference") || "") || undefined, narration: String(formData.get("narration")),
    });
    if (!result.ok) { setError(result.error); return; }
    setMessage("Contra voucher saved as draft. Approve and post it from Cash Book or Bank Book.");
  })}>
    <Select label="Company" required value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">Select</option>{companies.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</Select>
    <Select label="Financial year" name="financialYearId" required disabled={!companyId}><option value="">Select</option>{companyYears.map((row) => <option key={row.id} value={row.id}>{row.code}</option>)}</Select>
    <Select label="Cash register" name="cashLocationId" required disabled={!companyId}><option value="">Select</option>{companyLocations.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</Select>
    <Select label="Bank account" name="bankAccountId" required disabled={!companyId}><option value="">Select</option>{companyAccounts.map((row) => <option key={row.id} value={row.id}>{row.account_name} — {row.account_number}</option>)}</Select>
    <Select label="Transfer" name="direction" required><option value="cash_to_bank">Cash deposited into bank</option><option value="bank_to_cash">Cash withdrawn from bank</option></Select>
    <Input label="Date" name="voucherDate" type="date" required />
    <Input label="Amount" name="amount" type="number" min="0.0001" step="0.0001" required />
    <Input label="Bank reference / slip" name="reference" />
    <Input label="Narration" name="narration" required />
    <div className="self-end"><Button type="submit" disabled={pending}>Save contra draft</Button></div>
    {error ? <p className="text-sm text-[var(--danger)] md:col-span-4">{error}</p> : null}
    {message ? <p className="text-sm text-[var(--accent)] md:col-span-4">{message}</p> : null}
  </form>;
}
