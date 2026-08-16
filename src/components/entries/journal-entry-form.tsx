"use client";

import { useMemo, useState, useTransition } from "react";
import { createJournalEntry } from "@/lib/actions/daily-entries";
import { FinancialYearSelect } from "@/components/masters/financial-year-select";
import { Button, Input, Select } from "@/components/ui/primitives";
import { QuickCompanyBankAdd } from "@/components/entries/quick-company-bank-add";

type Company = { id: string; code: string; name: string };
type FinancialYear = { id: string; company_id: string; code: string };
type Ledger = { id: string; company_id: string; code: string; name: string };
type Line = { ledgerId: string; debitAmount: string; creditAmount: string };

export function JournalEntryForm({ companies, financialYears, ledgers, groups, banks }: {
  companies: Company[];
  financialYears: FinancialYear[];
  ledgers: Ledger[];
  groups: Array<{ id: string; code: string; name: string }>;
  banks: Array<{ id: string; code: string; name: string }>;
}) {
  const [companyId, setCompanyId] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { ledgerId: "", debitAmount: "", creditAmount: "" },
    { ledgerId: "", debitAmount: "", creditAmount: "" },
  ]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const companyLedgers = useMemo(() => ledgers.filter((ledger) => ledger.company_id === companyId), [ledgers, companyId]);

  const updateLine = (index: number, field: keyof Line, value: string) => {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  };

  return (
    <div className="space-y-3">
    <QuickCompanyBankAdd companies={companies} groups={groups} banks={banks} selectedCompanyId={companyId} onCompanyCreated={setCompanyId} onBankCreated={(_, createdCompanyId) => setCompanyId(createdCompanyId)} />
    <form className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4" action={(formData) => {
      startTransition(async () => {
        setError(null); setMessage(null);
        const result = await createJournalEntry({
          companyId,
          financialYearId: String(formData.get("financialYearId")),
          voucherDate: String(formData.get("voucherDate")),
          narration: String(formData.get("narration")),
          lines: lines.map((line) => ({
            ledgerId: line.ledgerId,
            debitAmount: Number(line.debitAmount || 0),
            creditAmount: Number(line.creditAmount || 0),
          })),
        });
        if (!result.ok) { setError(result.error); return; }
        setMessage(`Journal saved as draft ${result.data.id}`);
      });
    }}>
      <div className="grid gap-3 md:grid-cols-4">
        <Select label="Company" required value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
          <option value="">Select</option>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.code} — {company.name}</option>)}
        </Select>
        <FinancialYearSelect companyId={companyId} years={financialYears} name="financialYearId" required />
        <Input label="Date" name="voucherDate" type="date" required />
        <Input label="Narration" name="narration" required />
      </div>
      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[1fr_180px_180px_auto]">
            <Select label={`Ledger ${index + 1}`} value={line.ledgerId} required disabled={!companyId} onChange={(event) => updateLine(index, "ledgerId", event.target.value)}>
              <option value="">Select</option>
              {companyLedgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.code} — {ledger.name}</option>)}
            </Select>
            <Input label="Debit" type="number" min="0" step="0.0001" value={line.debitAmount} onChange={(event) => updateLine(index, "debitAmount", event.target.value)} />
            <Input label="Credit" type="number" min="0" step="0.0001" value={line.creditAmount} onChange={(event) => updateLine(index, "creditAmount", event.target.value)} />
            <Button type="button" variant="ghost" className="self-end" disabled={lines.length <= 2} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => setLines((current) => [...current, { ledgerId: "", debitAmount: "", creditAmount: "" }])}>Add line</Button>
        <Button type="submit" disabled={pending}>Save journal draft</Button>
        {error ? <span className="text-sm text-[var(--danger)]">{error}</span> : null}
        {message ? <span className="text-sm text-[var(--accent)]">{message}</span> : null}
      </div>
    </form>
    </div>
  );
}
