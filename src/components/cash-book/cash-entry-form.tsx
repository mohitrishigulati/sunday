"use client";

import { useMemo, useState, useTransition } from "react";
import { createCashBookEntry } from "@/lib/actions/cash-book";
import { Button, Input, Select } from "@/components/ui/primitives";

type Company = { id: string; code: string; name: string };
type Location = { id: string; company_id: string; code: string; name: string; cash_ledger_id: string | null };
type FinancialYear = { id: string; company_id: string; code: string };
type Ledger = { id: string; company_id: string; code: string; name: string; ledger_type: string };

export function CashEntryForm({ companies, locations, financialYears, ledgers }: {
  companies: Company[];
  locations: Location[];
  financialYears: FinancialYear[];
  ledgers: Ledger[];
}) {
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cashLocations = useMemo(() => locations.filter((l) => l.company_id === companyId), [locations, companyId]);
  const years = useMemo(() => financialYears.filter((y) => y.company_id === companyId), [financialYears, companyId]);
  const companyLedgers = useMemo(() => ledgers.filter((l) => l.company_id === companyId && l.ledger_type !== "cash"), [ledgers, companyId]);

  return (
    <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2" action={(fd) => {
      startTransition(async () => {
        setError(null); setSuccess(null);
        const result = await createCashBookEntry({
          companyId,
          locationId: String(fd.get("locationId")),
          financialYearId: String(fd.get("financialYearId")),
          voucherDate: String(fd.get("voucherDate")),
          entryKind: String(fd.get("entryKind")) as "receipt" | "payment",
          counterpartyLedgerId: String(fd.get("counterpartyLedgerId")),
          amount: Number(fd.get("amount")),
          narration: String(fd.get("narration")),
        });
        if (!result.ok) { setError(result.error); return; }
        setSuccess(`Cash entry saved as draft ${result.data.id}`);
      });
    }}>
      <Select label="Company" name="companyId" required value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
        <option value="">Select</option>
        {companies.map((company) => <option key={company.id} value={company.id}>{company.code} — {company.name}</option>)}
      </Select>
      <Select label="Cash location" name="locationId" required disabled={!companyId}>
        <option value="">Select</option>
        {cashLocations.map((location) => <option key={location.id} value={location.id}>{location.code} — {location.name}</option>)}
      </Select>
      <Select label="Financial year" name="financialYearId" required disabled={!companyId}>
        <option value="">Select</option>
        {years.map((year) => <option key={year.id} value={year.id}>{year.code}</option>)}
      </Select>
      <Input label="Date" name="voucherDate" type="date" required />
      <Select label="Entry" name="entryKind" required defaultValue="receipt">
        <option value="receipt">Received amount</option>
        <option value="payment">Paid amount</option>
      </Select>
      <Select label="Particular / Ledger" name="counterpartyLedgerId" required disabled={!companyId}>
        <option value="">Select</option>
        {companyLedgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.code} — {ledger.name}</option>)}
      </Select>
      <Input label="Amount" name="amount" type="number" step="0.0001" min="0.0001" required />
      <Input label="Narration" name="narration" required />
      {error ? <p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p> : null}
      {success ? <p className="text-sm text-[var(--accent)] md:col-span-2">{success}</p> : null}
      <div className="md:col-span-2"><Button type="submit" disabled={pending}>Save cash entry</Button></div>
    </form>
  );
}
