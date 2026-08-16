"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCashBookEntry, createFourSampleCashEntries } from "@/lib/actions/cash-book";
import { createParty } from "@/lib/actions/masters";
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
  mode = "both",
}: {
  companies: Company[];
  locations: Location[];
  financialYears: FinancialYear[];
  ledgers: Ledger[];
  parties: Party[];
  mode?: "both" | "receipt" | "payment";
}) {
  const [companyId, setCompanyId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [financialYearId, setFinancialYearId] = useState("");
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [partiesList, setPartiesList] = useState(parties);
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
  const allParties = useMemo(
    () =>
      [...partiesList].sort((a, b) =>
        a.name.localeCompare(b.name) || a.code.localeCompare(b.code),
      ),
    [partiesList],
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
    const companyLocations = locations.filter((item) => item.company_id === nextId);
    setLocationId(companyLocations[0]?.id ?? "");
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
      {ready ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                setSuccess(null);
                const result = await createFourSampleCashEntries({
                  companyId,
                  locationId,
                  financialYearId,
                  voucherDate,
                });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setSuccess("4 cash entries saved as draft (2 received, 2 paid). Approve/post queue mein dekho.");
              })
            }
          >
            4 sample entries daalo
          </Button>
        </div>
      ) : null}

      <div className="cash-register-section">
        <div className="cash-register-heading">
          <div>
            <p className="cash-register-kicker">CASH REGISTER ENTRY</p>
            <h3>Received from / Paid to</h3>
            <p>Left side = cash aaya. Right side = cash gaya. Party ka naam select karo.</p>
          </div>
        </div>
        <div className={`cash-register-book${mode === "both" ? "" : " cash-register-book--single"}`}>
          {mode !== "payment" ? (
          <RegisterEntryColumn
            side="receipt"
            title="RECEIPTS / प्राप्तियाँ"
            partyLabel="Received from"
            saveDisabled={!ready || pending}
            parties={allParties}
            ledgers={otherLedgers}
            groupId={company?.group_id ?? ""}
            onPartyCreated={(party) => setPartiesList((current) => [party, ...current.filter((item) => item.id !== party.id)])}
            onSave={(formData) => save("receipt", formData)}
          />
          ) : null}
          {mode !== "receipt" ? (
          <RegisterEntryColumn
            side="payment"
            title="PAYMENTS / भुगतान"
            partyLabel="Paid to"
            saveDisabled={!ready || pending}
            parties={allParties}
            ledgers={otherLedgers}
            groupId={company?.group_id ?? ""}
            onPartyCreated={(party) => setPartiesList((current) => [party, ...current.filter((item) => item.id !== party.id)])}
            onSave={(formData) => save("payment", formData)}
          />
          ) : null}
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
  saveDisabled,
  parties,
  ledgers,
  groupId,
  onPartyCreated,
  onSave,
}: {
  side: "receipt" | "payment";
  title: string;
  partyLabel: string;
  saveDisabled: boolean;
  parties: Party[];
  ledgers: Ledger[];
  groupId: string;
  onPartyCreated: (party: Party) => void;
  onSave: (formData: FormData) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [header, setHeader] = useState<"debtor" | "creditor" | "expense">(
    side === "receipt" ? "debtor" : "creditor",
  );
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, startAdd] = useTransition();
  const needle = query.trim().toLowerCase();
  const visible = parties.filter((party) => {
    if (party.id === selectedPartyId) return true;
    return !needle || `${party.code} ${party.name}`.toLowerCase().includes(needle);
  });
  const debtors = visible.filter((party) => headerOf(party.party_kinds) === "debtor");
  const creditors = visible.filter((party) => headerOf(party.party_kinds) === "creditor");
  const expenses = visible.filter((party) => headerOf(party.party_kinds) === "expense");
  const others = visible.filter((party) => headerOf(party.party_kinds) === "other");

  return (
    <form
      className={`cash-register-page cash-register-page--${side} space-y-3 p-4`}
      action={onSave}
    >
      <div className="cash-register-page-title">{title}</div>
      <Input
        label="Search party"
        value={query}
        placeholder="Type name or code"
        onChange={(event) => setQuery(event.target.value)}
      />
      <Select
        label={partyLabel}
        name="partyId"
        value={selectedPartyId}
        onChange={(event) => {
          if (event.target.value === "__new") {
            setAdding(true);
            setSelectedPartyId("");
            return;
          }
          setAdding(false);
          setSelectedPartyId(event.target.value);
        }}
      >
        <option value="">Select party ({parties.length})</option>
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
          <optgroup label="All other parties">
            {others.map((party) => (
              <option key={party.id} value={party.id}>
                {party.code} — {party.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        <option value="__new">+ Add new party</option>
      </Select>
      {adding ? (
        <div className="space-y-2 rounded border border-[var(--border)] bg-white p-2">
          <p className="text-xs font-medium">Nayi party</p>
          <input name="newCode" form="none" id={`${side}-code`} placeholder="Code" className="w-full rounded border px-2 py-1 text-sm" />
          <input name="newName" form="none" id={`${side}-name`} placeholder="Party name" className="w-full rounded border px-2 py-1 text-sm" />
          <fieldset className="space-y-1 text-xs">
            <legend className="font-medium">Account header</legend>
            <label className="flex gap-2"><input type="radio" checked={header === "debtor"} onChange={() => setHeader("debtor")} />Debtor</label>
            <label className="flex gap-2"><input type="radio" checked={header === "creditor"} onChange={() => setHeader("creditor")} />Creditor</label>
            <label className="flex gap-2"><input type="radio" checked={header === "expense"} onChange={() => setHeader("expense")} />Expense</label>
          </fieldset>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={addPending || !groupId}
              onClick={() =>
                startAdd(async () => {
                  setAddError(null);
                  const code = (document.getElementById(`${side}-code`) as HTMLInputElement | null)?.value.trim() ?? "";
                  const name = (document.getElementById(`${side}-name`) as HTMLInputElement | null)?.value.trim() ?? "";
                  const kinds = header === "debtor" ? ["customer" as const] : header === "creditor" ? ["supplier" as const] : ["expense" as const];
                  const created = await createParty({ groupId, code, name, partyKinds: kinds, creditDays: 0 });
                  if (!created.ok) {
                    setAddError(created.error);
                    return;
                  }
                  onPartyCreated({
                    id: created.data.id,
                    group_id: groupId,
                    code: code.toUpperCase(),
                    name,
                    party_kinds: kinds,
                  });
                  setSelectedPartyId(created.data.id);
                  setAdding(false);
                  router.refresh();
                })
              }
            >
              Add & select
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          {addError ? <p className="text-xs text-[var(--danger)]">{addError}</p> : null}
          {!groupId ? <p className="text-xs text-[var(--muted)]">Pehle company select karo.</p> : null}
        </div>
      ) : null}
      <Select label="Or other ledger (optional)" name="ledgerId">
        <option value="">If party has no ledger, pick here</option>
        {ledgers.map((ledger) => (
          <option key={ledger.id} value={ledger.id}>
            {ledger.code} — {ledger.name}
          </option>
        ))}
      </Select>
      <Input label="Amount (₹)" name="amount" type="number" step="0.0001" min="0.0001" required />
      <Input label="Particulars" name="narration" placeholder="UPI / cash / bill no." />
      <Button type="submit" disabled={saveDisabled} className="w-full">
        {side === "receipt" ? "Save received from" : "Save paid to"}
      </Button>
    </form>
  );
}
