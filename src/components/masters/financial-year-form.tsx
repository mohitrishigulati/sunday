"use client";

import { useMemo, useState, useTransition } from "react";
import { createFinancialYear, ensureIndianFinancialYear } from "@/lib/actions/masters";
import { indianFinancialYearForDate } from "@/lib/financial-year";
import { Button, Input, Select } from "@/components/ui/primitives";

export function FinancialYearForm({
  companies,
}: {
  companies: { id: string; code: string; name: string }[];
}) {
  const current = useMemo(() => indianFinancialYearForDate(), []);
  const [companyId, setCompanyId] = useState("");
  const [code, setCode] = useState(current.code);
  const [startDate, setStartDate] = useState(current.startDate);
  const [endDate, setEndDate] = useState(current.endDate);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        Indian financial year is 1 April to 31 March. New companies and bank
        statement imports create the matching year automatically. Use this only
        if a year is still missing.
      </p>
      <form
        className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2"
        action={() => {
          startTransition(async () => {
            setError(null);
            setMessage(null);
            const result = await createFinancialYear({
              companyId,
              code,
              startDate,
              endDate,
            });
            if (!result.ok) setError(result.error);
            else setMessage(`Financial year ${code} created with monthly periods.`);
          });
        }}
      >
        <Select
          label="Company"
          name="companyId"
          required
          value={companyId}
          onChange={(event) => {
            setCompanyId(event.target.value);
            const fy = indianFinancialYearForDate();
            setCode(fy.code);
            setStartDate(fy.startDate);
            setEndDate(fy.endDate);
          }}
        >
          <option value="">Select</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </Select>
        <Input
          label="FY code"
          name="code"
          required
          placeholder="2026-27"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <Input
          label="Start date"
          name="startDate"
          type="date"
          required
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <Input
          label="End date"
          name="endDate"
          type="date"
          required
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
        />
        {error ? <p className="text-sm text-[var(--danger)] md:col-span-2">{error}</p> : null}
        {message ? <p className="text-sm text-[var(--accent)] md:col-span-2">{message}</p> : null}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="submit" disabled={pending || !companyId}>
            Create FY + monthly periods
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending || !companyId}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                setMessage(null);
                const fy = indianFinancialYearForDate();
                const result = await ensureIndianFinancialYear(companyId, fy.startDate);
                if (!result.ok) setError(result.error);
                else
                  setMessage(
                    result.data.created
                      ? `Created ${result.data.code} (1 Apr to 31 Mar).`
                      : `${result.data.code} already exists.`,
                  );
              })
            }
          >
            Add current April–March year
          </Button>
        </div>
      </form>
    </div>
  );
}
