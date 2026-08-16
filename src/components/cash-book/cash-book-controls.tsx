"use client";

import { useMemo, useState, useTransition } from "react";
import { createCashLocationTransfer, verifyPhysicalCash } from "@/lib/actions/cash-book";
import { FinancialYearSelect } from "@/components/masters/financial-year-select";
import { Button, Input, Select } from "@/components/ui/primitives";

export function CashVerificationForm({ companies, locations }: {
  companies: Array<{id:string;code:string;name:string}>;
  locations: Array<{id:string;company_id:string;code:string;name:string}>;
}) {
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState<string|null>(null);
  const [message, setMessage] = useState<string|null>(null);
  const [pending, startTransition] = useTransition();
  const filtered = useMemo(() => locations.filter((location) => location.company_id === companyId), [locations, companyId]);
  return <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-4" action={(formData) => startTransition(async () => {
    setError(null); setMessage(null);
    const result = await verifyPhysicalCash({ companyId, locationId: String(formData.get("locationId")), verificationDate: String(formData.get("date")), physicalCashBalance: Number(formData.get("physical")), notes: String(formData.get("notes") || "") || undefined });
    if (!result.ok) { setError(result.error); return; }
    setMessage(`System ₹${result.data.systemBalance.toFixed(2)}; difference ₹${result.data.difference.toFixed(2)}`);
  })}>
    <Select label="Company" required value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">Select</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.code} — {company.name}</option>)}</Select>
    <Select label="Cash location" name="locationId" required disabled={!companyId}><option value="">Select</option>{filtered.map((location) => <option key={location.id} value={location.id}>{location.code} — {location.name}</option>)}</Select>
    <Input label="Verification date" name="date" type="date" required />
    <Input label="Physical cash counted" name="physical" type="number" min="0" step="0.0001" required />
    <Input label="Notes" name="notes" />
    <div className="self-end"><Button type="submit" disabled={pending}>Save verification</Button></div>
    {error ? <p className="text-sm text-[var(--danger)] md:col-span-4">{error}</p> : null}
    {message ? <p className="text-sm text-[var(--accent)] md:col-span-4">{message}</p> : null}
  </form>;
}

export function PrintCashBookButton() {
  return <Button type="button" variant="secondary" onClick={() => window.print()}>Print / Save PDF</Button>;
}

export function CashTransferForm({companies,locations,years,ledgers}:{companies:Array<{id:string;code:string;name:string}>;locations:Array<{id:string;company_id:string;code:string;name:string}>;years:Array<{id:string;company_id:string;code:string}>;ledgers:Array<{id:string;company_id:string;code:string;name:string;ledger_type:string}>}){const[companyId,setCompanyId]=useState("");const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);const[pending,startTransition]=useTransition();const companyLocations=locations.filter((location)=>location.company_id===companyId);return <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-4" action={(fd)=>startTransition(async()=>{setError(null);setMessage(null);const result=await createCashLocationTransfer({companyId,financialYearId:String(fd.get("fy")),fromLocationId:String(fd.get("from")),toLocationId:String(fd.get("to")),clearingLedgerId:String(fd.get("clearing")),transferDate:String(fd.get("date")),amount:Number(fd.get("amount")),narration:String(fd.get("narration"))});if(!result.ok){setError(result.error);return;}setMessage(`Paired cash transfer drafts created (${result.data.groupId})`);})}><Select label="Company" required value={companyId} onChange={(event)=>setCompanyId(event.target.value)}><option value="">Select</option>{companies.map((company)=><option key={company.id} value={company.id}>{company.code} — {company.name}</option>)}</Select><FinancialYearSelect companyId={companyId} years={years} name="fy" required /><Select label="From location" name="from" required><option value="">Select</option>{companyLocations.map((location)=><option key={location.id} value={location.id}>{location.code} — {location.name}</option>)}</Select><Select label="To location" name="to" required><option value="">Select</option>{companyLocations.map((location)=><option key={location.id} value={location.id}>{location.code} — {location.name}</option>)}</Select><Select label="Transfer clearing ledger" name="clearing" required><option value="">Select</option>{ledgers.filter((ledger)=>ledger.company_id===companyId&&ledger.ledger_type!=="cash").map((ledger)=><option key={ledger.id} value={ledger.id}>{ledger.code} — {ledger.name}</option>)}</Select><Input label="Date" name="date" type="date" required/><Input label="Amount" name="amount" type="number" min="0.0001" step="0.0001" required/><Input label="Narration" name="narration" required/>{error?<p className="text-sm text-[var(--danger)] md:col-span-4">{error}</p>:null}{message?<p className="text-sm text-[var(--accent)] md:col-span-4">{message}</p>:null}<div className="md:col-span-4"><Button type="submit" disabled={pending}>Create paired transfer drafts</Button></div></form>}
