"use client";

import { useMemo, useState, useTransition } from "react";
import { createCashBookEntry } from "@/lib/actions/cash-book";
import { indianFinancialYearForDate } from "@/lib/financial-year";
import { Button, Input, Select } from "@/components/ui/primitives";

type Company = { id: string; group_id: string; code: string; name: string };
type Location = { id: string; company_id: string; code: string; name: string; cash_ledger_id: string | null };
type FinancialYear = { id: string; company_id: string; code: string; start_date?: string; end_date?: string };
type Ledger = { id: string; company_id: string; party_id: string | null; code: string; name: string; ledger_type: string };
type Party = { id: string; group_id: string; code: string; name: string; party_kinds?: string[] };

function headerOf(kinds: string[] | undefined) {
  if (kinds?.includes("expense")) return "expense";
  if (kinds?.includes("customer")) return "debtor";
  if (kinds?.includes("supplier")) return "creditor";
  return "other";
}

export function CashEntryForm({
  companies,
  locations,
  financialYears,
  ledgers,
  parties,
}: {
  companies: Company[];
  locations: Location[];
  financialYears: FinancialYear[];
  ledgers: Ledger[];
  parties: Party[];
}) {
  const [companyId, setCompanyId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [financialYearId, setFinancialYearId] = useState("");
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const company = companies.find((item) => item.id === companyId);
  const cashLocations = useMemo(
    () => locations.filter((item) => item.company_id === companyId),
    [locations, companyId],
  );
  const years = useMemo(
    () => financialYears.filter((item) => item.company_id === companyId),
    [financialYears, companyId],
  );
  const companyParties = useMemo(
    () => parties.filter((party) => !company || party.group_id === company.group_id),
    [parties, company],
  );
  const otherLedgers = useMemo(
    () =>
      ledgers.filter(
        (ledger) =>
          ledger.company_id === companyId &&
          ledger.ledger_type !== "cash" &&
          !ledger.party_id,
      ),
    [ledgers, companyId],
  );

  function selectCompany(nextId: string) {
    setCompanyId(nextId);
    setLocationId("");
    const fy = indianFinancialYearForDate();
    const match = financialYears.find(
      (year) =>
        year.company_id === nextId &&
        year.start_date &&
        year.end_date &&
        year.start_date <= fy.startDate &&
        year.end_date >= fy.startDate,
    );
    setFinancialYearId(match?.id ?? financialYears.find((year) => year.company_id === nextId)?.id ?? "");
  }

  function save(kind: "receipt" | "payment", formData: FormData) {
    startTransition(async () => {
      setError(null);
      setSuccess(null);
      const partyId = String(formData.get("partyId") ?? "");
      const ledgerId = String(formData.get("ledgerId") ?? "");
      const result = await createCashBookEntry({
        companyId,
        locationId,
        financialYearId,
        voucherDate,
        entryKind: kind,
        partyId: partyId || undefined,
        counterpartyLedgerId: ledgerId || undefined,
        amount: Number(formData.get("amount")),
        narration: String(formData.get("narration") ?? "").trim() || (kind === "receipt" ? "Cash received" : "Cash paid"),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(
        kind === "receipt"
          ? "Receipt line saved as draft. Approve/post from the queue below."
          : "Payment line saved as draft. Approve/post from the queue below.",
      );
    });
  }

  const ready = Boolean(companyId && locationId && financialYearId && voucherDate);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-4">
        <Select label="Company" required value={companyId} onChange={(event) => selectCompany(event.target.value)}>
          <option value="">Select</option>
          {companies.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </Select>
        <Select label="Cash register / location" required disabled={!companyId} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
          <option value="">Select</option>
          {cashLocations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </Select>
        <Select label="Financial year" required disabled={!companyId} value={financialYearId} onChange={(event) => setFinancialYearId(event.target.value)}>
          <option value="">Select</option>
          {years.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code}
            </option>
          ))}
        </Select>
        <Input label="Date" type="date" required value={voucherDate} onChange={(event) => setVoucherDate(event.target.value)} />
      </div>

      <div className="cash-register-section">
        <div className="cash-register-heading">
          <div>
            <p className="cash-register-kicker">CASH REGISTER ENTRY</p>
            <h3>Received from / Paid to</h3>
            <p>Left side = cash aaya. Right side = cash gaya. Party ka naam select karo.</p>
          </div>
        </div>
        <div className="cash-register-book">
          <RegisterEntryColumn
            side="receipt"
            title="RECEIPTS / प्राप्तियाँ"
            partyLabel="Received from"
            disabled={!ready || pending}
            parties={companyParties}
            ledgers={otherLedgers}
            onSave={(formData) => save("receipt", formData)}
          />
          <RegisterEntryColumn
            side="payment"
            title="PAYMENTS / भुगतान"
            partyLabel="Paid to"
            disabled={!ready || pending}
            parties={companyParties}
            ledgers={otherLedgers}
            onSave={(formData) => save("payment", formData)}
          />
        </div>
      </div>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {success ? <p className="text-sm text-[var(--accent)]">{success}</p> : null}
      {!ready ? (
        <p className="text-sm text-[var(--muted)]">
          Pehle company, cash register, financial year aur date select karo.
        </p>
      ) : null}
    </div>
  );
}

function RegisterEntryColumn({
  side,
  title,
  partyLabel,
  disabled,
  parties,
  ledgers,
  onSave,
}: {
  side: "receipt" | "payment";
  title: string;
  partyLabel: string;
  disabled: boolean;
  parties: Party[];
  ledgers: Ledger[];
  onSave: (formData: FormData) => void;
}) {
  const debtors = parties.filter((party) => headerOf(party.party_kinds) === "debtor");
  const creditors = parties.filter((party) => headerOf(party.party_kinds) === "creditor");
  const expenses = parties.filter((party) => headerOf(party.party_kinds) === "expense");
  const others = parties.filter((party) => headerOf(party.party_kinds) === "other");

  return (
    <form
      className={`cash-register-page cash-register-page--${side} space-y-3 p-4`}
      action={onSave}
    >
      <div className="cash-register-page-title">{title}</div>
      <Select label={partyLabel} name="partyId" disabled={disabled}>
        <option value="">Select party</option>
        {debtors.length ? (
          <optgroup label="Debtor">
            {debtors.map((party) => (
              <option key={party.id} value={party.id}>
                {party.code} — {party.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {creditors.length ? (
          <optgroup label="Creditor">
            {creditors.map((party) => (
              <option key={party.id} value={party.id}>
                {party.code} — {party.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {expenses.length ? (
          <optgroup label="Expense">
            {expenses.map((party) => (
              <option key={party.id} value={party.id}>
                {party.code} — {party.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {others.length ? (
          <optgroup label="Other parties">
            {others.map((party) => (
              <option key={party.id} value={party.id}>
                {party.code} — {party.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
      <Select label="Or other ledger (optional)" name="ledgerId" disabled={disabled}>
        <option value="">If party has no ledger, pick here</option>
        {ledgers.map((ledger) => (
          <option key={ledger.id} value={ledger.id}>
            {ledger.code} — {ledger.name}
          </option>
        ))}
      </Select>
      <Input label="Amount (₹)" name="amount" type="number" step="0.0001" min="0.0001" required disabled={disabled} />
      <Input label="Particulars" name="narration" placeholder="UPI / cash / bill no." disabled={disabled} />
      <Button type="submit" disabled={disabled} className="w-full">
        {side === "receipt" ? "Save received from" : "Save paid to"}
      </Button>
    </form>
  );
}
