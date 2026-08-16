"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/format";
import { indianFinancialYearForDate } from "@/lib/financial-year";

const MONEY_SCALE = 10_000n;

type CashRegisterEntry = {
  id: string;
  voucherDate: string;
  voucherNumber: string | null;
  voucherType: string | null;
  narration: string | null;
  debitAmount: string | number;
  creditAmount: string | number;
};

export type CashRegister = {
  id: string;
  companyId: string;
  companyCode: string;
  locationCode: string;
  locationName: string;
  entries: CashRegisterEntry[];
};

type FinancialYear = {
  company_id: string;
  code: string;
  start_date?: string;
  end_date?: string;
};

function decimalUnits(value: string | number): bigint {
  const match = String(value ?? "0").trim().match(/^(-?)(\d+)(?:\.(\d{0,4}))?$/);
  if (!match) return 0n;
  const units = BigInt(match[2]) * MONEY_SCALE + BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] === "-" ? -units : units;
}

function money(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const decimal = `${sign}${absolute / MONEY_SCALE}.${String(absolute % MONEY_SCALE).padStart(4, "0")}`;
  return formatMoney(decimal);
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function TraditionalCashRegister({
  registers,
  financialYears = [],
}: {
  registers: CashRegister[];
  financialYears?: FinancialYear[];
}) {
  const currentFy = indianFinancialYearForDate();
  const fyCodes = useMemo(() => {
    const codes = new Map<string, string>();
    for (const year of financialYears) {
      if (!codes.has(year.code)) codes.set(year.code, year.start_date ?? year.code);
    }
    if (!codes.has(currentFy.code)) codes.set(currentFy.code, currentFy.startDate);
    return [...codes.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([code]) => code);
  }, [financialYears, currentFy.code, currentFy.startDate]);
  const companies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const register of registers) seen.set(register.companyId, register.companyCode);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [registers]);

  const [companyId, setCompanyId] = useState("");
  const [fyCode, setFyCode] = useState(currentFy.code);
  const [locationId, setLocationId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  if (registers.length === 0) {
    return <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">No configured cash location is available.</div>;
  }

  const fyRange = fyCode
    ? financialYears.find((year) => year.code === fyCode) ??
      (fyCode === currentFy.code ? { start_date: currentFy.startDate, end_date: currentFy.endDate } : null)
    : null;
  const periodStart = fromDate || fyRange?.start_date || "";
  const periodEnd = toDate || fyRange?.end_date || "";

  const companyRegisters = companyId
    ? registers.filter((register) => register.companyId === companyId)
    : registers;
  const locationOptions = companyRegisters;
  const visibleRegisters = locationId
    ? companyRegisters.filter((register) => register.id === locationId)
    : companyRegisters;

  return <div className="space-y-4"><div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 md:grid-cols-5"><label className="text-sm"><span className="mb-1 block font-medium">Company</span><select className="w-full rounded border px-2 py-1.5" value={companyId} onChange={(event) => { setCompanyId(event.target.value); setLocationId(""); }}><option value="">All companies</option>{companies.map(([id, code]) => <option key={id} value={id}>{code}</option>)}</select></label><label className="text-sm"><span className="mb-1 block font-medium">Financial year</span><select className="w-full rounded border px-2 py-1.5" value={fyCode} onChange={(event) => setFyCode(event.target.value)}>{fyCodes.map((code) => <option key={code} value={code}>{code}</option>)}</select></label><label className="text-sm"><span className="mb-1 block font-medium">Cash register</span><select className="w-full rounded border px-2 py-1.5" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">All cash books</option>{locationOptions.map((register) => <option key={register.id} value={register.id}>{register.companyCode} — {register.locationCode} — {register.locationName}</option>)}</select></label><label className="text-sm"><span className="mb-1 block font-medium">From date</span><input className="w-full rounded border px-2 py-1.5" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label className="text-sm"><span className="mb-1 block font-medium">To date</span><input className="w-full rounded border px-2 py-1.5" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div><p className="text-sm text-[var(--muted)]">{companyId ? "Is company ki saari cash books." : "Sabhi companies ki cash books."} Financial year {fyCode} har register par same hai.</p>{visibleRegisters.map((register) => {
    const openingBalance = register.entries.filter((entry) => !periodStart || entry.voucherDate < periodStart).reduce((sum, entry) => sum + decimalUnits(entry.debitAmount) - decimalUnits(entry.creditAmount), 0n);
    const selectedEntries = register.entries.filter((entry) => (!periodStart || entry.voucherDate >= periodStart) && (!periodEnd || entry.voucherDate <= periodEnd));
    let runningBalance = openingBalance;
    const rows = selectedEntries.map((entry) => {
      const receipt = decimalUnits(entry.debitAmount);
      const payment = decimalUnits(entry.creditAmount);
      runningBalance += receipt - payment;
      return { ...entry, receipt, payment, balance: runningBalance };
    });
    const receipts = rows.filter((row) => row.receipt > 0n);
    const payments = rows.filter((row) => row.payment > 0n);
    const totalReceipts = receipts.reduce((sum, row) => sum + row.receipt, 0n);
    const totalPayments = payments.reduce((sum, row) => sum + row.payment, 0n);
    const visibleRowCount = Math.max(receipts.length, payments.length, 8);

    return <section key={register.id} className="cash-register-section break-inside-avoid">
      <div className="cash-register-heading">
        <div><p className="cash-register-kicker">CASH BOOK</p><h3>{register.locationCode} — {register.locationName}</h3><p>{register.companyCode}</p></div>
        <div className="cash-register-balances" aria-label="Cash balance summary">
          <span>Opening <strong>{money(openingBalance)}</strong></span>
          <span>Receipts <strong>{money(totalReceipts)}</strong></span>
          <span>Payments <strong>{money(totalPayments)}</strong></span>
          <span>Closing <strong>{money(runningBalance)}</strong></span>
        </div>
      </div>
      <div className="cash-register-book">
        <RegisterPage side="receipt" title="RECEIPTS / प्राप्तियाँ" rows={receipts} rowCount={visibleRowCount} total={totalReceipts} />
        <RegisterPage side="payment" title="PAYMENTS / भुगतान" rows={payments} rowCount={visibleRowCount} total={totalPayments} />
      </div>
    </section>;
  })}</div>;
}

type PreparedRow = CashRegisterEntry & { receipt: bigint; payment: bigint; balance: bigint };

function RegisterPage({ side, title, rows, rowCount, total }: { side: "receipt" | "payment"; title: string; rows: PreparedRow[]; rowCount: number; total: bigint }) {
  return <div className={`cash-register-page cash-register-page--${side}`}>
    <div className="cash-register-page-title">{title}</div>
    <table>
      <thead><tr><th className="cash-col-date">Date</th><th>{side === "receipt" ? "Received from" : "Paid to"}</th><th className="cash-col-voucher">Voucher / Unique No.</th><th className="cash-col-amount">Amount (₹)</th><th className="cash-col-balance">Balance (₹)</th></tr></thead>
      <tbody>{Array.from({ length: rowCount }, (_, index) => {
        const row = rows[index];
        if (!row) return <tr key={`empty-${index}`} aria-hidden="true"><td>&nbsp;</td><td /><td /><td /><td /></tr>;
        const amount = side === "receipt" ? row.receipt : row.payment;
        return <tr key={row.id}>
          <td>{displayDate(row.voucherDate)}</td>
          <td><span className="cash-particulars">{row.narration || "—"}</span>{row.voucherType ? <small>{row.voucherType}</small> : null}</td>
          <td>{row.voucherNumber || "—"}</td><td className="cash-money">{money(amount)}</td><td className="cash-money">{money(row.balance)}</td>
        </tr>;
      })}</tbody>
      <tfoot><tr><th colSpan={3}>Total {side === "receipt" ? "receipts" : "payments"}</th><th className="cash-money">{money(total)}</th><th /></tr></tfoot>
    </table>
  </div>;
}
