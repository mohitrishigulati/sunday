"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCashBookEntry, createCashRegisterLocation, createFourSampleCashEntries, ensureCashBookSetup, seedThreeCashBooksWithTwentyEntries } from "@/lib/actions/cash-book";
import { createParty } from "@/lib/actions/masters";
import { indianFinancialYearForDate } from "@/lib/financial-year";
import { Button, Input, Select } from "@/components/ui/primitives";
import { FinancialYearSelect } from "@/components/masters/financial-year-select";

type Company = { id: string; group_id: string; code: string; name: string };
type Location = { id: string; company_id: string; code: string; name: string; cash_ledger_id: string | null };
type FinancialYear = { id: string; company_id: string; code: string; start_date?: string; end_date?: string };
type Ledger = { id: string; company_id: string; party_id: string | null; code: string; name: string; ledger_type: string };
type Party = { id: string; group_id: string; code: string; name: string; party_kinds?: string[] };

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
  const router = useRouter();
  const [companyId, setCompanyId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [financialYearId, setFinancialYearId] = useState("");
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [partiesList, setPartiesList] = useState(parties);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [extraLocations, setExtraLocations] = useState<Location[]>([]);
  const [newLocationCode, setNewLocationCode] = useState("HQ");
  const [newLocationName, setNewLocationName] = useState("Head office");

  const company = companies.find((item) => item.id === companyId);
  const cashLocations = useMemo(
    () => [...locations, ...extraLocations].filter((item) => item.company_id === companyId),
    [locations, extraLocations, companyId],
  );
  const allParties = useMemo(
    () =>
      [...partiesList]
        .filter((party) => !company || party.group_id === company.group_id)
        .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code)),
    [partiesList, company],
  );
  const shownParties = allParties.length ? allParties : [...partiesList].sort(
    (a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code),
  );
  const otherLedgers = useMemo(
    () =>
      ledgers.filter(
        (ledger) =>
          (!companyId || ledger.company_id === companyId) &&
          ledger.ledger_type !== "cash",
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
    if (!companyId || !locationId || !financialYearId || !voucherDate) {
      setError("Pehle company, cash register, financial year aur date select karo.");
      return;
    }
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
          ? "Receipt saved. Neeche Draft queue mein dikhegi — posted register ke liye approve/post karo."
          : "Payment saved. Neeche Draft queue mein dikhegi — posted register ke liye approve/post karo.",
      );
      router.refresh();
    });
  }

  const ready = Boolean(companyId && locationId && financialYearId && voucherDate);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2">
        <Select label="Company" required value={companyId} onChange={(event) => selectCompany(event.target.value)}>
          <option value="">Select</option>
          {companies.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </Select>
        <Input label="Date" type="date" required value={voucherDate} onChange={(event) => setVoucherDate(event.target.value)} />
        <Select
          label="Cash register / location"
          required
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
        >
          <option value="">Select</option>
          {cashLocations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </Select>
        <FinancialYearSelect
          companyId={companyId}
          years={financialYears}
          value={financialYearId}
          required
          onChange={setFinancialYearId}
        />
        <div className="space-y-2 rounded-md border border-dashed border-[var(--border)] p-3 md:col-span-2">
          <p className="text-sm font-medium">+ Add cash location yahin</p>
          <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
            <Input label="Code" value={newLocationCode} onChange={(event) => setNewLocationCode(event.target.value)} placeholder="HQ" />
            <Input label="Name" value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} placeholder="Head office" />
            <div className="self-end">
              <Button
                type="button"
                variant="secondary"
                disabled={pending || !companyId}
                onClick={() =>
                  startTransition(async () => {
                    if (!companyId) {
                      setError("Pehle company select karo.");
                      return;
                    }
                    setError(null);
                    const result = await createCashRegisterLocation({
                      companyId,
                      code: newLocationCode,
                      name: newLocationName,
                    });
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setExtraLocations((current) => [
                      { id: result.data.id, company_id: companyId, code: result.data.code, name: result.data.name, cash_ledger_id: result.data.id },
                      ...current.filter((item) => item.id !== result.data.id),
                    ]);
                    setLocationId(result.data.id);
                    setSetupHint(`Cash location added: ${result.data.code} — ${result.data.name}`);
                    router.refresh();
                  })
                }
              >
                Add location
              </Button>
            </div>
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={pending || !companyId}
        onClick={() =>
          startTransition(async () => {
            if (!companyId) return;
            setError(null);
            const result = await ensureCashBookSetup(companyId);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setLocationId(result.data.locationId);
            setFinancialYearId(result.data.financialYearId);
            setSetupHint(`Cash register: ${result.data.locationLabel}. Year: ${result.data.yearCode}.`);
            router.refresh();
          })
        }
      >
        Create cash register & year for this company
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={pending || !companyId}
        onClick={() =>
          startTransition(async () => {
            if (!companyId) return;
            setError(null);
            setSuccess(null);
            const result = await seedThreeCashBooksWithTwentyEntries({
              companyId,
              voucherDate,
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setSuccess(
              `Cash Book 1 / 2 / 3 ready. ${result.data.receipts} receipts and ${result.data.payments} payments saved as drafts.`,
            );
            router.refresh();
          })
        }
      >
        Create Cash Book 1–3 + 20 entries
      </Button>
      {setupHint ? <p className="text-sm text-[var(--accent)]">{setupHint}</p> : null}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {success ? <p className="text-sm text-[var(--accent)]">{success}</p> : null}
      <ol className="list-decimal space-y-1 rounded-lg border border-[var(--border)] bg-white px-5 py-3 text-sm text-[var(--ink)]">
        <li>Company choose karo. Agar location/year khali ho to <strong>Create cash register & year</strong> dabao, phir list ki line pe click karo.</li>
        <li>Neeche party ki line pe <strong>click</strong> karo — dropdown nahi, list se choose karo.</li>
        <li>Amount bharo.</li>
        <li>Left = cash aaya (Save received from). Right = cash gaya (Save paid to).</li>
      </ol>
      {!ready ? (
        <p className="text-sm text-[var(--danger)]">
          Company ya cash register missing hai. Masters mein company + cash location banao.
        </p>
      ) : null}
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
                router.refresh();
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
            <p>Party ki line pe click karo. Dropdown se select nahi — list se tap karo.</p>
          </div>
        </div>
        <div className={`cash-register-book${mode === "both" ? "" : " cash-register-book--single"}`}>
          {mode !== "payment" ? (
          <RegisterEntryColumn
            side="receipt"
            title="RECEIPTS / प्राप्तियाँ"
            partyLabel="Received from"
            saveDisabled={pending}
            parties={shownParties}
            ledgers={otherLedgers}
            groupId={company?.group_id ?? ""}
            companyId={companyId}
            onPartyCreated={(party) => setPartiesList((current) => [party, ...current.filter((item) => item.id !== party.id)])}
            onSave={(formData) => save("receipt", formData)}
          />
          ) : null}
          {mode !== "receipt" ? (
          <RegisterEntryColumn
            side="payment"
            title="PAYMENTS / भुगतान"
            partyLabel="Paid to"
            saveDisabled={pending}
            parties={shownParties}
            ledgers={otherLedgers}
            groupId={company?.group_id ?? ""}
            companyId={companyId}
            onPartyCreated={(party) => setPartiesList((current) => [party, ...current.filter((item) => item.id !== party.id)])}
            onSave={(formData) => save("payment", formData)}
          />
          ) : null}
        </div>
      </div>
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
  companyId,
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
  companyId: string;
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
  const [selectedLedgerId, setSelectedLedgerId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, startAdd] = useTransition();
  const needle = query.trim().toLowerCase();
  const visible = parties.filter((party) => {
    if (party.id === selectedPartyId) return true;
    return !needle || `${party.code} ${party.name}`.toLowerCase().includes(needle);
  });

  return (
    <form
      className={`cash-register-page cash-register-page--${side} space-y-3 p-4`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(new FormData(event.currentTarget));
      }}
    >
      <div className="cash-register-page-title">{title}</div>
      <input type="hidden" name="partyId" value={selectedPartyId} />
      <input type="hidden" name="ledgerId" value={selectedLedgerId} />
      <Input
        label="Search party"
        value={query}
        placeholder="Type name or code"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div>
        <p className="mb-1 text-sm font-medium">{partyLabel}</p>
        <div className="max-h-52 overflow-y-auto rounded-md border border-[var(--border)] bg-white">
          {visible.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--muted)]">
              {parties.length === 0
                ? "Koi party nahi. Neeche + New party dabao."
                : "Is search se koi party nahi mili."}
            </p>
          ) : (
            visible.map((party) => (
              <button
                key={party.id}
                type="button"
                className={`block w-full border-b border-[var(--border)] px-3 py-2 text-left text-sm last:border-b-0 ${
                  selectedPartyId === party.id
                    ? "bg-[var(--accent)] text-white"
                    : "hover:bg-[var(--surface-2)]"
                }`}
                onClick={() => {
                  setAdding(false);
                  setSelectedPartyId(party.id);
                  setSelectedLedgerId("");
                }}
              >
                {party.code} — {party.name}
              </button>
            ))
          )}
        </div>
        <button
          type="button"
          className="mt-1 text-sm font-medium text-[var(--accent)]"
          onClick={() => {
            setAdding(true);
            setSelectedPartyId("");
          }}
        >
          + New party
        </button>
      </div>
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
                  const created = await createParty({ groupId, code, name, partyKinds: kinds, creditDays: 0, companyId: companyId || undefined });
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
      <div>
        <p className="mb-1 text-sm font-medium">Or pick a ledger (optional)</p>
        <div className="max-h-36 overflow-y-auto rounded-md border border-[var(--border)] bg-white">
          <button
            type="button"
            className={`block w-full border-b border-[var(--border)] px-3 py-2 text-left text-sm ${
              !selectedLedgerId ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]"
            }`}
            onClick={() => setSelectedLedgerId("")}
          >
            None — party use karo
          </button>
          {ledgers.map((ledger) => (
            <button
              key={ledger.id}
              type="button"
              className={`block w-full border-b border-[var(--border)] px-3 py-2 text-left text-sm last:border-b-0 ${
                selectedLedgerId === ledger.id
                  ? "bg-[var(--accent)] text-white"
                  : "hover:bg-[var(--surface-2)]"
              }`}
              onClick={() => {
                setSelectedLedgerId(ledger.id);
                setSelectedPartyId("");
              }}
            >
              {ledger.code} — {ledger.name}
            </button>
          ))}
        </div>
      </div>
      <Input label="Amount (₹)" name="amount" type="number" step="0.0001" min="0.0001" required />
      <Input label="Particulars" name="narration" placeholder="UPI / cash / bill no." />
      <Button type="submit" disabled={saveDisabled} className="w-full">
        {side === "receipt" ? "Save received from" : "Save paid to"}
      </Button>
    </form>
  );
}
