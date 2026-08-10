"use client";

import { useMemo, useState, useTransition } from "react";
import { createOpeningBalanceVoucher } from "@/lib/actions/vouchers";
import { Button, Input, Select } from "@/components/ui/primitives";

type Ledger = { id: string; code: string; name: string; company_id: string };
type FY = { id: string; code: string; company_id: string; start_date: string };

type Line = {
  ledgerId: string;
  debitAmount: string;
  creditAmount: string;
};

export function OpeningBalanceForm({
  companies,
  financialYears,
  ledgers,
}: {
  companies: { id: string; code: string; name: string }[];
  financialYears: FY[];
  ledgers: Ledger[];
}) {
  const [companyId, setCompanyId] = useState("");
  const [financialYearId, setFinancialYearId] = useState("");
  const [voucherDate, setVoucherDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([
    { ledgerId: "", debitAmount: "", creditAmount: "" },
    { ledgerId: "", debitAmount: "", creditAmount: "" },
  ]);
  const [pending, startTransition] = useTransition();

  const companyLedgers = useMemo(
    () => ledgers.filter((l) => l.company_id === companyId),
    [ledgers, companyId],
  );
  const companyYears = useMemo(
    () => financialYears.filter((y) => y.company_id === companyId),
    [financialYears, companyId],
  );

  const totalDr = lines.reduce((s, l) => s + Number(l.debitAmount || 0), 0);
  const totalCr = lines.reduce((s, l) => s + Number(l.creditAmount || 0), 0);

  // Company drives which years and ledgers are valid, so reset every dependent
  // field when it changes rather than leaving another company's values behind.
  const onCompanyChange = (nextCompanyId: string) => {
    setCompanyId(nextCompanyId);
    const firstYear = financialYears.find((y) => y.company_id === nextCompanyId);
    setFinancialYearId(firstYear?.id ?? "");
    setVoucherDate(firstYear?.start_date ?? "");
    setLines((prev) => prev.map((l) => ({ ...l, ledgerId: "" })));
    setError(null);
    setSuccess(null);
  };

  return (
    <form
      className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      action={(fd) => {
        startTransition(async () => {
          setError(null);
          setSuccess(null);
          const result = await createOpeningBalanceVoucher({
            companyId,
            financialYearId,
            voucherDate,
            narration: String(fd.get("narration") || "") || undefined,
            postImmediately: false,
            lines: lines.map((l) => ({
              ledgerId: l.ledgerId,
              debitAmount: Number(l.debitAmount || 0),
              creditAmount: Number(l.creditAmount || 0),
            })),
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setSuccess(
            result.data.voucherNumber
              ? `Posted as ${result.data.voucherNumber}`
              : `Saved draft ${result.data.id}`,
          );
        });
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label="Company"
          name="companyId"
          required
          value={companyId}
          onChange={(e) => onCompanyChange(e.target.value)}
        >
          <option value="">Select</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </Select>
        <Select
          label="Financial year"
          name="financialYearId"
          required
          value={financialYearId}
          onChange={(e) => setFinancialYearId(e.target.value)}
        >
          <option value="">Select</option>
          {companyYears.map((y) => (
            <option key={y.id} value={y.id}>
              {y.code}
            </option>
          ))}
        </Select>
        <Input
          label="Voucher date"
          name="voucherDate"
          type="date"
          required
          value={voucherDate}
          onChange={(e) => setVoucherDate(e.target.value)}
        />
        <Input label="Narration" name="narration" defaultValue="Opening balances" />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Lines</h3>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setLines((prev) => [
                ...prev,
                { ledgerId: "", debitAmount: "", creditAmount: "" },
              ])
            }
          >
            Add line
          </Button>
        </div>
        {lines.map((line, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-3">
            <select
              required
              className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
              value={line.ledgerId}
              onChange={(e) =>
                setLines((prev) =>
                  prev.map((l, i) =>
                    i === index ? { ...l, ledgerId: e.target.value } : l,
                  ),
                )
              }
            >
              <option value="">Ledger</option>
              {companyLedgers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.0001"
              min="0"
              placeholder="Debit"
              className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
              value={line.debitAmount}
              onChange={(e) =>
                setLines((prev) =>
                  prev.map((l, i) =>
                    i === index
                      ? { ...l, debitAmount: e.target.value, creditAmount: "" }
                      : l,
                  ),
                )
              }
            />
            <input
              type="number"
              step="0.0001"
              min="0"
              placeholder="Credit"
              className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
              value={line.creditAmount}
              onChange={(e) =>
                setLines((prev) =>
                  prev.map((l, i) =>
                    i === index
                      ? { ...l, creditAmount: e.target.value, debitAmount: "" }
                      : l,
                  ),
                )
              }
            />
          </div>
        ))}
        <p className="text-sm text-[var(--muted)]">
          Totals — Debit {totalDr.toFixed(4)} / Credit {totalCr.toFixed(4)}
          {Number(totalDr.toFixed(4)) !== Number(totalCr.toFixed(4))
            ? " (out of balance)"
            : " (balanced)"}
        </p>
      </div>

      <p className="text-sm text-[var(--muted)]">
        This saves a draft. An authorised approver must approve and post it separately.
      </p>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {success ? <p className="text-sm text-[var(--accent)]">{success}</p> : null}

      <Button type="submit" disabled={pending}>
        Save opening balance voucher
      </Button>
    </form>
  );
}
