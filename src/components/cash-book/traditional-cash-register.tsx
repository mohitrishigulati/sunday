import { formatMoney } from "@/lib/format";

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
  companyCode: string;
  locationCode: string;
  locationName: string;
  entries: CashRegisterEntry[];
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

export function TraditionalCashRegister({ registers }: { registers: CashRegister[] }) {
  if (registers.length === 0) {
    return <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">No configured cash location is available.</div>;
  }

  return <div className="space-y-8">{registers.map((register) => {
    let runningBalance = 0n;
    const rows = register.entries.map((entry) => {
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
          <span>Opening <strong>{money(0n)}</strong></span>
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
      <thead><tr><th className="cash-col-date">Date</th><th>Particulars</th><th className="cash-col-voucher">Voucher / Unique No.</th><th className="cash-col-amount">Amount (₹)</th><th className="cash-col-balance">Balance (₹)</th></tr></thead>
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
