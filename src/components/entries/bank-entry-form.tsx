"use client";

import { useMemo, useState, useTransition } from "react";
import { createBankBookEntry } from "@/lib/actions/daily-entries";
import { Button, Input, Select } from "@/components/ui/primitives";
import { QuickCompanyBankAdd } from "@/components/entries/quick-company-bank-add";

type Company = { id: string; code: string; name: string };
type FinancialYear = { id: string; company_id: string; code: string };
type Ledger = { id: string; company_id: string; code: string; name: string; ledger_type: string };
type BankAccount = { id: string; company_id: string; account_name: string; account_number: string; ledger_id: string };

export function BankEntryForm({ companies, financialYears, ledgers, bankAccounts, groups, banks }: {
  companies: Company[];
  financialYears: FinancialYear[];
  ledgers: Ledger[];
  bankAccounts: BankAccount[];
  groups: Array<{ id: string; code: string; name: string }>;
  banks: Array<{ id: string; code: string; name: string }>;
}) {
  const [companyId, setCompanyId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const years = useMemo(() => financialYears.filter((year) => year.company_id === companyId), [financialYears, companyId]);
  const accounts = useMemo(() => bankAccounts.filter((account) => account.company_id === companyId), [bankAccounts, companyId]);
  const companyLedgers = useMemo(() => ledgers.filter((ledger) => ledger.company_id === companyId && ledger.ledger_type !== "bank"), [ledgers, companyId]);

  return (
    <div className="space-y-3">
    <QuickCompanyBankAdd companies={companies} groups={groups} banks={banks} selectedCompanyId={companyId} onCompanyCreated={(id) => { setCompanyId(id); setBankAccountId(""); }} onBankCreated={(id, createdCompanyId) => { setCompanyId(createdCompanyId); setBankAccountId(id); }} />
    <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-3" action={(formData) => {
      startTransition(async () => {
        setError(null); setMessage(null);
        const result = await createBankBookEntry({
          companyId,
          financialYearId: String(formData.get("financialYearId")),
          bankAccountId: String(formData.get("bankAccountId")),
          voucherDate: String(formData.get("voucherDate")),
          entryKind: String(formData.get("entryKind")) as "receipt" | "payment",
          counterpartyLedgerId: String(formData.get("counterpartyLedgerId")),
          amount: Number(formData.get("amount")),
          reference: String(formData.get("reference") || "") || undefined,
          narration: String(formData.get("narration")),
        });
        if (!result.ok) { setError(result.error); return; }
        setMessage(`Bank entry saved as draft ${result.data.id}`);
      });
    }}>
      <Select label="Company" required value={companyId} onChange={(event) => { setCompanyId(event.target.value); setBankAccountId(""); }}>
        <option value="">Select</option>
        {companies.map((company) => <option key={company.id} value={company.id}>{company.code} — {company.name}</option>)}
      </Select>
      <Select label="Bank account" name="bankAccountId" required disabled={!companyId} value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>
        <option value="">Select</option>
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.account_name} — {account.account_number}</option>)}
      </Select>
      <Select label="Financial year" name="financialYearId" required disabled={!companyId}>
        <option value="">Select</option>
        {years.map((year) => <option key={year.id} value={year.id}>{year.code}</option>)}
      </Select>
      <Input label="Date" name="voucherDate" type="date" required />
      <Select label="Entry" name="entryKind" required defaultValue="receipt">
        <option value="receipt">Received in bank</option>
        <option value="payment">Paid from bank</option>
      </Select>
      <Select label="Particular / Ledger" name="counterpartyLedgerId" required disabled={!companyId}>
        <option value="">Select</option>
        {companyLedgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.code} — {ledger.name}</option>)}
      </Select>
      <Input label="Amount" name="amount" type="number" min="0.0001" step="0.0001" required />
      <Input label="Bank reference / UTR" name="reference" />
      <Input label="Narration" name="narration" required />
      {error ? <p className="text-sm text-[var(--danger)] md:col-span-3">{error}</p> : null}
      {message ? <p className="text-sm text-[var(--accent)] md:col-span-3">{message}</p> : null}
      <div className="md:col-span-3"><Button type="submit" disabled={pending}>Save bank entry</Button></div>
    </form>
    </div>
  );
}
