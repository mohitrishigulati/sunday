"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBankAccount, createBankMaster, createCompany } from "@/lib/actions/masters";
import { Button, Input, Select } from "@/components/ui/primitives";

type Company = { id: string; code: string; name: string };
type Group = { id: string; code: string; name: string };
type Bank = { id: string; code: string; name: string };

export function QuickCompanyBankAdd({
  companies,
  groups,
  banks,
  selectedCompanyId,
  onCompanyCreated,
  onBankCreated,
}: {
  companies: Company[];
  groups: Group[];
  banks: Bank[];
  selectedCompanyId?: string;
  onCompanyCreated?: (companyId: string) => void;
  onBankCreated?: (bankAccountId: string, companyId: string) => void;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<"company" | "bank" | "bankName" | null>(null);
  const [bankCompanyId, setBankCompanyId] = useState(selectedCompanyId ?? "");
  const [bankMasterId, setBankMasterId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = (next: "company" | "bank" | "bankName") => {
    setError(null);
    setMessage(null);
    if (next === "bank" && selectedCompanyId) setBankCompanyId(selectedCompanyId);
    setPanel((current) => (current === next ? null : next));
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Not available in the list?</span>
        <Button variant="secondary" onClick={() => open("company")}>+ Add company</Button>
        <Button variant="secondary" onClick={() => open("bank")}>+ Add bank account</Button>
        <Button variant="secondary" onClick={() => open("bankName")}>+ Add bank name</Button>
      </div>

      {panel === "company" ? (
        <form
          className="grid gap-3 border-t border-[var(--border)] pt-3 md:grid-cols-3"
          action={(formData) => startTransition(async () => {
            setError(null);
            setMessage(null);
            const result = await createCompany({
              groupId: String(formData.get("groupId")),
              code: String(formData.get("code")),
              name: String(formData.get("name")),
              legalName: String(formData.get("legalName") || "") || undefined,
              gstin: String(formData.get("gstin") || "") || undefined,
              stateCode: String(formData.get("stateCode") || "") || undefined,
              pan: String(formData.get("pan") || "") || undefined,
            });
            if (!result.ok) { setError(result.error); return; }
            setMessage("Company created and selected. You can add its bank account now.");
            setBankCompanyId(result.data.id);
            onCompanyCreated?.(result.data.id);
            router.refresh();
          })}
        >
          <Select label="Company group" name="groupId" required defaultValue={groups.length === 1 ? groups[0].id : ""}>
            <option value="">Select group</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.code} — {group.name}</option>)}
          </Select>
          <Input label="Company code" name="code" required placeholder="COMP-01" />
          <Input label="Company name" name="name" required />
          <Input label="Legal name" name="legalName" />
          <Input label="GSTIN" name="gstin" />
          <Input label="State code" name="stateCode" maxLength={2} />
          <Input label="PAN" name="pan" maxLength={10} />
          <div className="self-end"><Button type="submit" disabled={pending || groups.length === 0}>Create and select company</Button></div>
          {groups.length === 0 ? <p className="text-sm text-[var(--danger)] md:col-span-3">Create a company group first.</p> : null}
        </form>
      ) : null}

      {panel === "bankName" ? (
        <form className="grid gap-3 border-t border-[var(--border)] pt-3 md:grid-cols-3" action={(formData) => startTransition(async () => {
          setError(null); setMessage(null);
          const result = await createBankMaster({ code: String(formData.get("code")), name: String(formData.get("name")) });
          if (!result.ok) { setError(result.error); return; }
          setBankMasterId(result.data.id);
          setMessage("Bank name added. Open Add bank account to use it.");
          router.refresh();
        })}>
          <Input label="Bank short code" name="code" required placeholder="YES" />
          <Input label="Bank name" name="name" required placeholder="Yes Bank Limited" />
          <div className="self-end"><Button type="submit" disabled={pending}>Add bank name</Button></div>
        </form>
      ) : null}

      {panel === "bank" ? (
        <form
          className="grid gap-3 border-t border-[var(--border)] pt-3 md:grid-cols-3"
          action={(formData) => startTransition(async () => {
            setError(null);
            setMessage(null);
            const companyId = String(formData.get("companyId"));
            const accountType = String(formData.get("accountType"));
            const result = await createBankAccount({
              companyId,
              bankId: String(formData.get("bankId") || "") || undefined,
              accountName: String(formData.get("accountName")),
              accountNumber: String(formData.get("accountNumber")),
              ifsc: String(formData.get("ifsc") || "") || undefined,
              accountType: accountType as "current" | "savings" | "od" | "cc",
              ledgerCode: String(formData.get("ledgerCode")),
              ledgerName: String(formData.get("ledgerName")),
            });
            if (!result.ok) { setError(result.error); return; }
            setMessage("Bank account created and selected for this entry.");
            onBankCreated?.(result.data.id, companyId);
            router.refresh();
          })}
        >
          <Select label="Company" name="companyId" required value={bankCompanyId} onChange={(event) => setBankCompanyId(event.target.value)}>
            <option value="">Select company</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.code} — {company.name}</option>)}
          </Select>
          <Select label="Bank name" name="bankId" value={bankMasterId} onChange={(event) => setBankMasterId(event.target.value)}>
            <option value="">Other / not listed</option>
            {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.code} — {bank.name}</option>)}
          </Select>
          <Select label="Account type" name="accountType" defaultValue="current">
            <option value="current">Current</option><option value="savings">Savings</option><option value="od">OD</option><option value="cc">CC</option>
          </Select>
          <Input label="Account name" name="accountName" required />
          <Input label="Account number" name="accountNumber" required />
          <Input label="IFSC" name="ifsc" />
          <Input label="Bank ledger code" name="ledgerCode" required placeholder="BANK-HDFC-01" />
          <Input label="Bank ledger name" name="ledgerName" required placeholder="HDFC Bank Current A/c" />
          <div className="self-end"><Button type="submit" disabled={pending || !bankCompanyId}>Create and select bank account</Button></div>
        </form>
      ) : null}

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {message ? <p className="text-sm text-[var(--accent)]">{message}</p> : null}
    </div>
  );
}
