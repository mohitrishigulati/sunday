"use client";

import { useState, useTransition } from "react";
import { approveClosingStock, closeFinancialYearAction, createClosingStockDraft, reverseVoucherAction, setPeriodLock } from "@/lib/actions/controls";
import { Button, Input, Select } from "@/components/ui/primitives";

export function PeriodLockButton({ periodId, locked }: { periodId: string; locked: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div><Button variant={locked ? "secondary" : "primary"} disabled={pending} onClick={() => startTransition(async () => { setError(null); const result = await setPeriodLock(periodId, !locked); if (!result.ok) setError(result.error); })}>{locked ? "Unlock" : "Lock"}</Button>{error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}</div>;
}

export function ReversalForm({ vouchers }: { vouchers: Array<{ id: string; voucher_number: string; voucher_date: string; company_code: string }> }) {
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  return <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-3" action={(formData) => startTransition(async () => { setError(null); setMessage(null); const result = await reverseVoucherAction({ voucherId: String(formData.get("voucherId")), reversalDate: String(formData.get("reversalDate")), narration: String(formData.get("narration") || "") || undefined }); if (!result.ok) { setError(result.error); return; } setMessage(`Reversal posted: ${result.data.voucherNumber}`); })}>
    <Select label="Posted voucher" name="voucherId" required><option value="">Select</option>{vouchers.map((voucher) => <option key={voucher.id} value={voucher.id}>{voucher.company_code} — {voucher.voucher_number} — {voucher.voucher_date}</option>)}</Select>
    <Input label="Reversal date" name="reversalDate" type="date" required />
    <Input label="Reason / narration" name="narration" />
    {error ? <p className="text-sm text-[var(--danger)] md:col-span-3">{error}</p> : null}{message ? <p className="text-sm text-[var(--accent)] md:col-span-3">{message}</p> : null}
    <div className="md:col-span-3"><Button type="submit" disabled={pending}>Post reversal</Button></div>
  </form>;
}

export function FinancialYearCloseForm({ years, equityLedgers }: { years: Array<{ id: string; company_id: string; code: string; is_closed: boolean }>; equityLedgers: Array<{ id: string; company_id: string; code: string; name: string }> }) {
  const [from, setFrom] = useState(""); const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null); const [pending, startTransition] = useTransition(); const companyId = years.find((year) => year.id === from)?.company_id ?? "";
  return <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-4" action={(formData) => startTransition(async () => { setError(null); setMessage(null); const result = await closeFinancialYearAction({ fromFinancialYearId: from, toFinancialYearId: String(formData.get("toFy")), retainedEarningsLedgerId: String(formData.get("ledger")) }); if (!result.ok) { setError(result.error); return; } setMessage(`Year closed; carry-forward voucher ${result.data.voucherNumber}`); })}>
    <Select label="Close financial year" required value={from} onChange={(event) => setFrom(event.target.value)}><option value="">Select</option>{years.filter((year) => !year.is_closed).map((year) => <option key={year.id} value={year.id}>{year.code}</option>)}</Select>
    <Select label="Next financial year" name="toFy" required><option value="">Select</option>{years.filter((year) => year.company_id === companyId && year.id !== from).map((year) => <option key={year.id} value={year.id}>{year.code}</option>)}</Select>
    <Select label="Retained earnings ledger" name="ledger" required><option value="">Select</option>{equityLedgers.filter((ledger) => ledger.company_id === companyId).map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.code} — {ledger.name}</option>)}</Select>
    <div className="self-end"><Button type="submit" disabled={pending || !from}>Close & carry forward</Button></div>{error ? <p className="text-sm text-[var(--danger)] md:col-span-4">{error}</p> : null}{message ? <p className="text-sm text-[var(--accent)] md:col-span-4">{message}</p> : null}
  </form>;
}

export function ClosingStockForm({ companies, years }: { companies:Array<{id:string;code:string;name:string}>;years:Array<{id:string;company_id:string;code:string}> }) {
  const [companyId,setCompanyId]=useState("");const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);const[pending,startTransition]=useTransition();
  return <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-5" action={(fd)=>startTransition(async()=>{setError(null);setMessage(null);const result=await createClosingStockDraft({companyId,financialYearId:String(fd.get("fy")),asOfDate:String(fd.get("date")),amount:Number(fd.get("amount")),narration:String(fd.get("narration")||"")||undefined});if(!result.ok){setError(result.error);return;}setMessage(`Closing stock draft saved ${result.data.id}`);})}><Select label="Company" required value={companyId} onChange={(event)=>setCompanyId(event.target.value)}><option value="">Select</option>{companies.map((company)=><option key={company.id} value={company.id}>{company.code} — {company.name}</option>)}</Select><Select label="Financial year" name="fy" required disabled={!companyId}><option value="">Select</option>{years.filter((year)=>year.company_id===companyId).map((year)=><option key={year.id} value={year.id}>{year.code}</option>)}</Select><Input label="As of date" name="date" type="date" required/><Input label="Stock value" name="amount" type="number" min="0" step="0.0001" required/><Input label="Narration" name="narration"/>{error?<p className="text-sm text-[var(--danger)] md:col-span-5">{error}</p>:null}{message?<p className="text-sm text-[var(--accent)] md:col-span-5">{message}</p>:null}<div className="md:col-span-5"><Button type="submit" disabled={pending}>Save closing stock draft</Button></div></form>;
}

export function ApproveClosingStockButton({id}:{id:string}){const[error,setError]=useState<string|null>(null);const[pending,startTransition]=useTransition();return <div><Button disabled={pending} onClick={()=>startTransition(async()=>{setError(null);const result=await approveClosingStock(id);if(!result.ok)setError(result.error);})}>Approve</Button>{error?<p className="text-xs text-[var(--danger)]">{error}</p>:null}</div>;}
