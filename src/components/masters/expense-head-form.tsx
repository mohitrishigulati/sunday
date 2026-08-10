"use client";

import { useMemo, useState, useTransition } from "react";
import { createExpenseHead } from "@/lib/actions/masters";
import { Button, Input, Select } from "@/components/ui/primitives";

type Company = { id: string; code: string; name: string };
type Ledger = { id: string; company_id: string; code: string; name: string };

export function ExpenseHeadForm({ companies, ledgers }: { companies: Company[]; ledgers: Ledger[] }) {
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const companyLedgers = useMemo(() => ledgers.filter((ledger) => ledger.company_id === companyId), [companyId, ledgers]);

  return (
    <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2" action={(formData) => {
      startTransition(async () => {
        setError(null); setMessage(null);
        const result = await createExpenseHead({ companyId, ledgerId:String(formData.get("ledgerId")), code:String(formData.get("code")), name:String(formData.get("name")) });
        if (!result.ok) setError(result.error); else setMessage("Expense head created successfully.");
      });
    }}>
      <h2 className="font-semibold md:col-span-2">Add expense head</h2>
      <p className="text-sm text-[var(--muted)] md:col-span-2">Examples: salary, rent, freight, travelling, electricity, office expense and commission.</p>
      <Select label="Company" required value={companyId} onChange={(event)=>setCompanyId(event.target.value)}><option value="">Select company</option>{companies.map((company)=><option key={company.id} value={company.id}>{company.code} — {company.name}</option>)}</Select>
      <Select label="Expense ledger" name="ledgerId" required disabled={!companyId}><option value="">{companyLedgers.length?"Select expense ledger":"Create an expense-nature ledger first"}</option>{companyLedgers.map((ledger)=><option key={ledger.id} value={ledger.id}>{ledger.code} — {ledger.name}</option>)}</Select>
      <Input label="Expense code" name="code" required placeholder="RENT" />
      <Input label="Expense name" name="name" required placeholder="Office Rent" />
      {error?<p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p>:null}
      {message?<p className="text-sm text-[var(--accent)] md:col-span-2">{message}</p>:null}
      <div className="md:col-span-2"><Button type="submit" disabled={pending||companyLedgers.length===0}>Create expense head</Button></div>
    </form>
  );
}
