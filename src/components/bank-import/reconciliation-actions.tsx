"use client";

import { useState, useTransition } from "react";
import { createBankReconciliation, setBankLineMatch } from "@/lib/actions/bank-import";
import { createBankBookEntry } from "@/lib/actions/daily-entries";
import { Button, Input, Select } from "@/components/ui/primitives";

export function BankLineMatcher({ lineId, companyId, vouchers }: { lineId: string; companyId: string; vouchers: Array<{ id: string; company_id: string; voucher_number: string; voucher_date: string }> }) {
  const [voucherId, setVoucherId] = useState(""); const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  const available = vouchers.filter((voucher) => voucher.company_id === companyId);
  const run = (ignore: boolean) => startTransition(async () => { setError(null); const result = await setBankLineMatch(lineId, voucherId || undefined, ignore); if (!result.ok) setError(result.error); });
  return <div className="min-w-64"><div className="flex gap-2"><select className="min-w-36 rounded border px-2 py-1" value={voucherId} onChange={(event) => setVoucherId(event.target.value)}><option value="">Posted voucher</option>{available.map((voucher) => <option key={voucher.id} value={voucher.id}>{voucher.voucher_number} — {voucher.voucher_date}</option>)}</select><Button disabled={pending || !voucherId} onClick={() => run(false)}>Match</Button><Button variant="ghost" disabled={pending} onClick={() => run(true)}>Ignore</Button></div>{error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}</div>;
}

export function CreateEntryFromStatementLine({ line, years, ledgers }: { line: { companyId: string; bankAccountId: string; date: string; description: string; reference: string; debitAmount: number; creditAmount: number }; years: Array<{ id: string; company_id: string; code: string }>; ledgers: Array<{ id: string; company_id: string; code: string; name: string; ledger_type: string }> }) {
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  const matchingYears = years.filter((year) => year.company_id === line.companyId); const matchingLedgers = ledgers.filter((ledger) => ledger.company_id === line.companyId && ledger.ledger_type !== "bank");
  const entryKind = line.creditAmount > 0 ? "receipt" : "payment"; const amount = line.creditAmount > 0 ? line.creditAmount : line.debitAmount;
  return <form className="mt-2 flex min-w-[430px] flex-wrap items-end gap-2 rounded border border-dashed border-[var(--border)] p-2" action={(fd) => startTransition(async () => {
    setError(null); setMessage(null); const result = await createBankBookEntry({ companyId: line.companyId, bankAccountId: line.bankAccountId, financialYearId: String(fd.get("financialYearId")), voucherDate: line.date, entryKind, counterpartyLedgerId: String(fd.get("ledgerId")), amount, reference: line.reference || undefined, narration: line.description || `Statement ${entryKind}` });
    if (!result.ok) { setError(result.error); return; } setMessage("Draft created. Approve/post it, then select it above to match.");
  })}>
    <span className="text-xs font-medium">Create {entryKind} draft</span><select name="financialYearId" required className="rounded border px-2 py-1 text-sm"><option value="">Year</option>{matchingYears.map((year) => <option key={year.id} value={year.id}>{year.code}</option>)}</select><select name="ledgerId" required className="min-w-44 rounded border px-2 py-1 text-sm"><option value="">Paid to / Received from</option>{matchingLedgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.code} — {ledger.name}</option>)}</select><Button type="submit" variant="secondary" disabled={pending}>Create</Button>
    {error ? <p className="w-full text-xs text-[var(--danger)]">{error}</p> : null}{message ? <p className="w-full text-xs text-[var(--accent)]">{message}</p> : null}
  </form>;
}

export function ReconciliationForm({ accounts }: { accounts: Array<{ id: string; account_name: string; account_number: string }> }) {
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  return <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-4" action={(fd) => startTransition(async () => { setError(null); setMessage(null); const result = await createBankReconciliation({ bankAccountId: String(fd.get("bankAccountId")), asOfDate: String(fd.get("asOfDate")), statementClosing: Number(fd.get("statementClosing")) }); if (!result.ok) { setError(result.error); return; } setMessage(`Saved. Difference: ${result.data.difference.toFixed(4)}`); })}><Select label="Bank account" name="bankAccountId" required><option value="">Select</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.account_name} — {account.account_number}</option>)}</Select><Input label="As of date" name="asOfDate" type="date" required /><Input label="Statement closing" name="statementClosing" type="number" step="0.0001" required /><div className="self-end"><Button type="submit" disabled={pending}>Reconcile</Button></div>{error ? <p className="text-sm text-[var(--danger)] md:col-span-4">{error}</p> : null}{message ? <p className="text-sm text-[var(--accent)] md:col-span-4">{message}</p> : null}</form>;
}
