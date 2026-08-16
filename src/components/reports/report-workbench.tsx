"use client";

import { useMemo, useState } from "react";
import { Button, DataTable, Input, Select } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { BankStatementPartySelector } from "@/components/reports/bank-statement-party-selector";
import { indianFinancialYearForDate } from "@/lib/financial-year";
import { validateStatementBalances } from "@/lib/bank-statement-validation";

type Company = { id: string; group_id: string; code: string; name: string };
type PartyOption = {
  id: string;
  group_id: string;
  code: string;
  name: string;
  party_kinds?: string[];
};
type GroupBankAccount = {
  id: string;
  company_id: string;
  account_name: string;
  account_number: string;
  companies: { group_id: string; code: string; name: string } | null;
};
type FinancialYear = {
  id: string;
  company_id: string;
  code: string;
  start_date?: string;
  end_date?: string;
};
type ClosingStock = {
  company_id: string;
  financial_year_id: string;
  as_of_date: string;
  amount: number | string;
  status: string;
};
type Posting = {
  id: string;
  voucher_id: string;
  voucher_date: string;
  voucher_number: string;
  company_id: string;
  financial_year_id: string;
  ledger_id: string;
  party_id: string | null;
  debit_amount: number | string;
  credit_amount: number | string;
  ledgers: {
    code: string;
    name: string;
    ledger_type: string;
    account_groups: {
      nature: string;
      bs_pl_section: string | null;
      cash_flow_category: string | null;
      working_capital_class: string | null;
    } | null;
  } | null;
  parties: { code: string; name: string } | null;
  vouchers: {
    narration: string | null;
    voucher_types: { code: string } | null;
  } | null;
};
type BusinessDocument = {
  id: string;
  company_id: string;
  party_id: string;
  document_type: string;
  document_number: string;
  document_date: string;
  due_date: string;
  taxable_amount: number | string;
  cgst_amount: number | string;
  sgst_amount: number | string;
  igst_amount: number | string;
  cess_amount: number | string;
  tds_amount: number | string;
  total_amount: number | string;
  eway_bill_no: string | null;
  companies: { code: string } | null;
  parties: { code: string; name: string; party_kinds: string[] } | null;
  voucher_allocations: Array<{ amount: number | string }>;
};
type DocumentLine = {
  taxable_amount: number | string;
  salesmen: {
    name: string;
    role_type: string;
    default_commission_pct: number | string;
  } | null;
  business_documents: {
    document_type: string;
    document_number: string;
    document_date: string;
    company_id: string;
    party_id: string;
    companies: { code: string } | null;
  } | null;
};
type Salary = {
  company_id: string;
  employee_party_id: string;
  salary_month: string;
  gross_amount: number | string;
  deductions: number | string;
  net_amount: number | string;
  employer_contribution: number | string;
  status: string;
  companies: { code: string } | null;
  parties: { code: string; name: string } | null;
  locations: { code: string } | null;
};
type BankStatementLine = {
  id: string;
  import_id: string;
  statement_sequence: number;
  bank_account_id: string;
  txn_date: string;
  value_date: string | null;
  description: string | null;
  reference: string | null;
  transaction_type: string | null;
  debit_amount: number | string;
  credit_amount: number | string;
  balance_after: number | string | null;
  match_status: string;
  suggested_party_id: string | null;
  counterparty_bank_account_id: string | null;
  bank_accounts: {
    company_id: string;
    account_name: string;
    account_number: string;
  } | null;
  bank_statement_imports: { imported_at: string } | null;
};

const reportNames = {
  bank_statement: "Bank Statement Ledger (uploaded)",
  day: "Day Book",
  trial: "Trial Balance",
  ledger: "Accounting Ledger (posted)",
  party: "Party Ledger (date-wise)",
  trading: "Trading Account",
  pnl: "Profit & Loss",
  balance: "Balance Sheet",
  sales: "Sales register",
  purchase: "Purchase register",
  expense: "Expense head-wise",
  cashflow: "Cash Flow Statement",
  fundflow: "Fund Flow / Working Capital",
  outstanding: "Party Outstanding & Ageing",
  gst: "GST / TDS / E-way Bill Register",
  commission: "Salesman / Broker Commission",
  salary: "Salary Register",
} as const;

function decimalUnits(value: number | string): bigint {
  const text = String(value).trim();
  const match = text.match(/^(-?)(\d+)(?:\.(\d{0,4}))?/);
  if (!match) return 0n;
  const units =
    BigInt(match[2]) * 10000n + BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] === "-" ? -units : units;
}

function unitsAsDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 10000n}.${String(absolute % 10000n).padStart(4, "0")}`;
}

function formatUnits(value: bigint): string {
  return formatMoney(unitsAsDecimal(value));
}

function balanceLabel(value: bigint): string {
  if (value === 0n) return formatUnits(value);
  return `${formatUnits(value < 0n ? -value : value)} ${value > 0n ? "Dr" : "Cr"}`;
}

type PartyMovement = {
  partyId: string;
  date: string;
  companyId: string;
  voucher: string;
  type: string;
  narration: string;
  debit: bigint;
  credit: bigint;
};

function partyMovementsFromStatementLines(
  lines: BankStatementLine[],
  companyId: string,
  partyId: string,
): PartyMovement[] {
  return lines.flatMap((line) => {
    if (!line.suggested_party_id) return [];
    if (line.match_status === "ignored" || line.match_status === "matched")
      return [];
    if (companyId && line.bank_accounts?.company_id !== companyId) return [];
    if (partyId && line.suggested_party_id !== partyId) return [];
    const paid = Number(line.debit_amount) > 0;
    const debit = paid ? decimalUnits(line.debit_amount) : 0n;
    const credit = paid ? 0n : decimalUnits(line.credit_amount);
    if (debit === 0n && credit === 0n) return [];
    const bankName = line.bank_accounts?.account_name ?? "Bank";
    const particulars = [line.description, line.reference]
      .filter(Boolean)
      .join(" / ");
    return [
      {
        partyId: line.suggested_party_id,
        date: line.txn_date,
        companyId: line.bank_accounts?.company_id ?? "",
        voucher: line.reference || `STMT-${line.statement_sequence}`,
        type: "STMT",
        narration: `${paid ? "Paid" : "Received"} · ${bankName}${particulars ? ` · ${particulars}` : ""}`,
        debit,
        credit,
      },
    ];
  });
}

function reportTable() {
  const table = document.querySelector("[data-report-output] table");
  if (!table) return null;
  const headers = Array.from(table.querySelectorAll("thead th")).map((cell) =>
    (cell.textContent ?? "").trim(),
  );
  const rows = Array.from(table.querySelectorAll("tbody tr")).map((row) =>
    Array.from(row.querySelectorAll("td")).map((cell) =>
      (cell.textContent ?? "").trim(),
    ),
  );
  return { headers, rows };
}

function fileSlug(value: string) {
  return `${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${new Date().toISOString().slice(0, 10)}`;
}

function ExportButtons({
  title,
  details,
}: {
  title: string;
  details: string[];
}) {
  const exportExcel = async () => {
    const output = reportTable();
    if (!output) {
      window.alert("No report rows are available to export.");
      return;
    }
    const XLSX = await import("xlsx");
    const data = [
      [title],
      ...details.map((detail) => [detail]),
      [],
      output.headers,
      ...output.rows,
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    if (output.headers.length > 1)
      worksheet["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: output.headers.length - 1 } },
      ];
    worksheet["!cols"] = output.headers.map((header, index) => ({
      wch: Math.min(
        42,
        Math.max(
          header.length + 2,
          ...output.rows.map((row) => (row[index] ?? "").length + 2),
        ),
      ),
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
    XLSX.writeFile(workbook, `${fileSlug(title)}.xlsx`);
  };

  const exportPdf = async () => {
    const output = reportTable();
    if (!output) {
      window.alert("No report rows are available to export.");
      return;
    }
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const landscape = output.headers.length > 6;
    const documentPdf = new jsPDF({
      orientation: landscape ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });
    const safe = (value: string) =>
      value.replaceAll("₹", "Rs. ").replaceAll("—", "-").replaceAll("–", "-");
    documentPdf.setFont("helvetica", "bold");
    documentPdf.setFontSize(15);
    documentPdf.text(safe(title), 12, 14);
    documentPdf.setFont("helvetica", "normal");
    documentPdf.setFontSize(8);
    details.forEach((detail, index) =>
      documentPdf.text(safe(detail), 12, 20 + index * 4),
    );
    autoTable(documentPdf, {
      startY: 23 + details.length * 4,
      head: [output.headers.map(safe)],
      body: output.rows.map((row) => row.map(safe)),
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: landscape ? 6.5 : 7.5,
        cellPadding: 1.5,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [34, 91, 67],
        textColor: 255,
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [245, 248, 246] },
      margin: { left: 8, right: 8 },
      didDrawPage: ({ pageNumber }) => {
        documentPdf.setFontSize(7);
        documentPdf.text(
          `Page ${pageNumber}`,
          documentPdf.internal.pageSize.getWidth() - 20,
          documentPdf.internal.pageSize.getHeight() - 5,
        );
      },
    });
    documentPdf.save(`${fileSlug(title)}.pdf`);
  };

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button type="button" variant="secondary" onClick={exportExcel}>
        Download Excel
      </Button>
      <Button type="button" variant="secondary" onClick={exportPdf}>
        Download PDF
      </Button>
    </div>
  );
}

export function ReportWorkbench({
  companies,
  financialYears,
  postings,
  closingStocks,
  documents,
  documentLines,
  salaries,
  bankStatementLines,
  parties,
  groupBankAccounts,
}: {
  companies: Company[];
  financialYears: FinancialYear[];
  postings: Posting[];
  closingStocks: ClosingStock[];
  documents: BusinessDocument[];
  documentLines: DocumentLine[];
  salaries: Salary[];
  bankStatementLines: BankStatementLine[];
  parties: PartyOption[];
  groupBankAccounts: GroupBankAccount[];
}) {
  const [companyId, setCompanyId] = useState("");
  const [financialYearId, setFinancialYearId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [report, setReport] = useState<keyof typeof reportNames>("trial");
  const [ledgerId, setLedgerId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [partyId, setPartyId] = useState("");
  const years = financialYears.filter((year) => year.company_id === companyId);
  const companyYearPostings = useMemo(
    () =>
      postings.filter(
        (posting) =>
          (!companyId || posting.company_id === companyId) &&
          (!financialYearId || posting.financial_year_id === financialYearId),
      ),
    [postings, companyId, financialYearId],
  );
  const partyOptions = useMemo(() => {
    const options = new Map(
      companyYearPostings
        .filter((posting) => posting.party_id)
        .map((posting) => [
          posting.party_id!,
          {
            id: posting.party_id!,
            code: posting.parties?.code ?? "",
            name: posting.parties?.name ?? "Unknown party",
          },
        ]),
    );
    for (const document of documents)
      if (
        (!companyId || document.company_id === companyId) &&
        document.party_id
      )
        options.set(document.party_id, {
          id: document.party_id,
          code: document.parties?.code ?? "",
          name: document.parties?.name ?? "Unknown party",
        });
    for (const salary of salaries)
      if (
        (!companyId || salary.company_id === companyId) &&
        salary.employee_party_id
      )
        options.set(salary.employee_party_id, {
          id: salary.employee_party_id,
          code: salary.parties?.code ?? "",
          name: salary.parties?.name ?? "Unknown party",
        });
    const selectedCompany = companies.find((company) => company.id === companyId);
    for (const party of parties)
      if (!companyId || party.group_id === selectedCompany?.group_id)
        options.set(party.id, {
          id: party.id,
          code: party.code,
          name: party.name,
        });
    for (const line of bankStatementLines) {
      if (!line.suggested_party_id) continue;
      if (companyId && line.bank_accounts?.company_id !== companyId) continue;
      const party = parties.find((item) => item.id === line.suggested_party_id);
      if (party)
        options.set(party.id, {
          id: party.id,
          code: party.code,
          name: party.name,
        });
    }
    return Array.from(options.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [
    companyYearPostings,
    documents,
    salaries,
    companyId,
    companies,
    parties,
    bankStatementLines,
  ]);
  const scoped = useMemo(() => {
    const dated = companyYearPostings.filter(
      (posting) =>
        (!fromDate || posting.voucher_date >= fromDate) &&
        (!toDate || posting.voucher_date <= toDate),
    );
    if (!partyId) return dated;
    const partyVouchers = new Set(
      dated
        .filter((posting) => posting.party_id === partyId)
        .map((posting) => posting.voucher_id),
    );
    return dated.filter((posting) => partyVouchers.has(posting.voucher_id));
  }, [companyYearPostings, fromDate, toDate, partyId]);
  const ledgers = useMemo(
    () =>
      Array.from(
        new Map(
          scoped.map((posting) => [
            posting.ledger_id,
            {
              id: posting.ledger_id,
              code: posting.ledgers?.code ?? "",
              name: posting.ledgers?.name ?? "Unknown ledger",
            },
          ]),
        ).values(),
      ).sort((a, b) => a.code.localeCompare(b.code)),
    [scoped],
  );
  const ledgerTotals = useMemo(() => {
    const totals = new Map<
      string,
      {
        code: string;
        name: string;
        nature: string;
        section: string;
        cashFlow: string;
        workingCapital: string;
        debit: number;
        credit: number;
      }
    >();
    for (const posting of scoped) {
      const row = totals.get(posting.ledger_id) ?? {
        code: posting.ledgers?.code ?? "",
        name: posting.ledgers?.name ?? "Unknown ledger",
        nature: posting.ledgers?.account_groups?.nature ?? "unclassified",
        section: posting.ledgers?.account_groups?.bs_pl_section ?? "",
        cashFlow:
          posting.ledgers?.account_groups?.cash_flow_category ?? "unclassified",
        workingCapital:
          posting.ledgers?.account_groups?.working_capital_class ??
          "unclassified",
        debit: 0,
        credit: 0,
      };
      row.debit += Number(posting.debit_amount);
      row.credit += Number(posting.credit_amount);
      totals.set(posting.ledger_id, row);
    }
    return Array.from(totals.values()).sort((a, b) =>
      a.code.localeCompare(b.code),
    );
  }, [scoped]);
  const approvedClosingStock = closingStocks
    .filter(
      (stock) =>
        stock.status === "approved" &&
        (!companyId || stock.company_id === companyId) &&
        (!financialYearId || stock.financial_year_id === financialYearId) &&
        (!toDate || stock.as_of_date <= toDate),
    )
    .reduce((sum, stock) => sum + Number(stock.amount), 0);
  const bankAccounts = useMemo(
    () =>
      Array.from(
        new Map(
          bankStatementLines
            .filter(
              (line) =>
                !companyId || line.bank_accounts?.company_id === companyId,
            )
            .map((line) => [
              line.bank_account_id,
              {
                id: line.bank_account_id,
                name: line.bank_accounts?.account_name ?? "Bank",
                number: line.bank_accounts?.account_number ?? "",
              },
            ]),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [bankStatementLines, companyId],
  );
  const bankBalanceChecks = useMemo(() => {
    const byImport = new Map<string, BankStatementLine[]>();
    for (const line of bankStatementLines) {
      const importRows = byImport.get(line.import_id) ?? [];
      importRows.push(line);
      byImport.set(line.import_id, importRows);
    }
    const checks = new Map<
      string,
      { calculatedBalance?: number; difference?: number; valid: boolean; message?: string }
    >();
    for (const importRows of byImport.values()) {
      importRows.sort((left, right) => left.statement_sequence - right.statement_sequence);
      const validation = validateStatementBalances(
        importRows.map((line) => ({
          txnDate: line.txn_date,
          debitAmount: Number(line.debit_amount),
          creditAmount: Number(line.credit_amount),
          balanceAfter: line.balance_after === null ? undefined : Number(line.balance_after),
        })),
      );
      importRows.forEach((line, index) => checks.set(line.id, validation.checks[index]));
    }
    return checks;
  }, [bankStatementLines]);
  const exportDetails = [
    `Company: ${companies.find((company) => company.id === companyId)?.name ?? "All accessible companies"}`,
    `Financial year: ${financialYears.find((year) => year.id === financialYearId)?.code ?? "All years"}`,
    `Period: ${fromDate || "Beginning"} to ${toDate || "Current"}`,
    `Party: ${partyOptions.find((party) => party.id === partyId)?.name ?? "All parties"}`,
    `Generated: ${new Date().toLocaleString("en-IN")}`,
  ];

  let table: React.ReactNode;
  if (report === "bank_statement") {
    const rows = bankStatementLines
      .filter(
        (line) =>
          (!companyId || line.bank_accounts?.company_id === companyId) &&
          (!bankAccountId || line.bank_account_id === bankAccountId) &&
          (!fromDate || line.txn_date >= fromDate) &&
          (!toDate || line.txn_date <= toDate),
      )
      .sort((left, right) => {
        const importOrder = (right.bank_statement_imports?.imported_at ?? "").localeCompare(
          left.bank_statement_imports?.imported_at ?? "",
        );
        return importOrder || left.statement_sequence - right.statement_sequence;
      });
    table = (
      <div className="space-y-3">
        <Select
          label="Bank account"
          value={bankAccountId}
          onChange={(event) => setBankAccountId(event.target.value)}
        >
          <option value="">All bank accounts</option>
          {bankAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} — {account.number}
            </option>
          ))}
        </Select>
        <p className="text-xs text-[var(--muted)]">Latest uploaded statement is shown first; every statement keeps the bank file&apos;s original row order.</p>
        <DataTable
          className="bank-statement-grid"
          tableClassName="table-fixed"
          dense
          stickyHeader
          columns={[
            "S.No.",
            "Transaction date",
            "Value date",
            "Bank",
            "Particulars",
            "Ref./Cheque No.",
            "Transaction type",
            "Debit (Rs)",
            "Credit (Rs)",
            "Balance (Rs)",
            "Balance check",
            "Paid to / Received from",
            "Status",
          ]}
          rows={rows.map((line) => {
            const balanceCheck = bankBalanceChecks.get(line.id);
            const company = companies.find(
              (item) => item.id === line.bank_accounts?.company_id,
            );
            const availableParties = parties.filter(
              (party) => party.group_id === company?.group_id,
            );
            const availableBanks = groupBankAccounts
              .filter((bank) => bank.companies?.group_id === company?.group_id)
              .map((bank) => ({
                id: bank.id,
                companyId: bank.company_id,
                companyCode: bank.companies?.code ?? "",
                accountName: bank.account_name,
                accountNumber: bank.account_number,
              }));
            return [
              line.statement_sequence,
              line.txn_date,
              line.value_date ?? "—",
              line.bank_accounts?.account_name ?? "—",
              line.description ?? "—",
              line.reference ?? "—",
              line.transaction_type ??
                (Number(line.debit_amount) > 0 ? "Debit" : "Credit"),
              Number(line.debit_amount) > 0
                ? formatMoney(line.debit_amount)
                : "—",
              Number(line.credit_amount) > 0
                ? formatMoney(line.credit_amount)
                : "—",
              line.balance_after === null
                ? "—"
                : formatMoney(line.balance_after),
              balanceCheck?.calculatedBalance === undefined
                ? balanceCheck?.message ?? "Not checked"
                : `Calc ${formatMoney(balanceCheck.calculatedBalance)} · Difference ${formatMoney(balanceCheck.difference ?? 0)} · ${balanceCheck.valid ? "Matched" : "Mismatch"}`,
              company ? (
                <BankStatementPartySelector
                  key={line.id}
                  lineId={line.id}
                  groupId={company.group_id}
                  direction={
                    Number(line.credit_amount) > 0 ? "received" : "paid"
                  }
                  selectedPartyId={line.suggested_party_id}
                  selectedBankAccountId={line.counterparty_bank_account_id}
                  sourceBankAccountId={line.bank_account_id}
                  sourceCompanyId={company.id}
                  parties={availableParties}
                  bankAccounts={availableBanks}
                />
              ) : (
                "—"
              ),
              line.match_status,
            ];
          })}
        />
      </div>
    );
  } else if (report === "day") {
    const vouchers = new Map<
      string,
      {
        date: string;
        number: string;
        type: string;
        narration: string;
        debit: number;
        credit: number;
      }
    >();
    for (const posting of scoped) {
      const row = vouchers.get(posting.voucher_id) ?? {
        date: posting.voucher_date,
        number: posting.voucher_number,
        type: posting.vouchers?.voucher_types?.code ?? "",
        narration: posting.vouchers?.narration ?? "",
        debit: 0,
        credit: 0,
      };
      row.debit += Number(posting.debit_amount);
      row.credit += Number(posting.credit_amount);
      vouchers.set(posting.voucher_id, row);
    }
    table = (
      <DataTable
        columns={["Date", "Voucher", "Type", "Narration", "Debit", "Credit"]}
        rows={Array.from(vouchers.values())
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((row) => [
            row.date,
            row.number,
            row.type,
            row.narration || "—",
            formatMoney(row.debit),
            formatMoney(row.credit),
          ])}
      />
    );
  } else if (report === "ledger") {
    const rows = scoped.filter(
      (posting) => !ledgerId || posting.ledger_id === ledgerId,
    );
    // Build the rows up-front and carry the balance on an object, as the day book
    // does. A captured `let` accumulator can re-run past a memo boundary and
    // compound the running balance on re-render.
    const acc = { balance: 0 };
    const ledgerRows: string[][] = [];
    for (const posting of rows) {
      acc.balance +=
        Number(posting.debit_amount) - Number(posting.credit_amount);
      ledgerRows.push([
        posting.voucher_date,
        posting.voucher_number,
        `${posting.ledgers?.code ?? ""} — ${posting.ledgers?.name ?? ""}`,
        posting.vouchers?.narration ?? "—",
        Number(posting.debit_amount) ? formatMoney(posting.debit_amount) : "—",
        Number(posting.credit_amount)
          ? formatMoney(posting.credit_amount)
          : "—",
        formatMoney(acc.balance),
      ]);
    }
    table = (
      <div className="space-y-3">
        <Select
          label="Ledger"
          value={ledgerId}
          onChange={(event) => setLedgerId(event.target.value)}
        >
          <option value="">All ledgers</option>
          {ledgers.map((ledger) => (
            <option key={ledger.id} value={ledger.id}>
              {ledger.code} — {ledger.name}
            </option>
          ))}
        </Select>
        <DataTable
          columns={[
            "Date",
            "Voucher",
            "Ledger",
            "Narration",
            "Debit",
            "Credit",
            "Balance",
          ]}
          rows={ledgerRows}
        />
      </div>
    );
  } else if (report === "party") {
    const postedMovements: PartyMovement[] = companyYearPostings
      .filter(
        (posting) =>
          posting.party_id &&
          posting.ledgers?.ledger_type === "party" &&
          (!partyId || posting.party_id === partyId),
      )
      .map((posting) => ({
        partyId: posting.party_id!,
        date: posting.voucher_date,
        companyId: posting.company_id,
        voucher: posting.voucher_number,
        type: posting.vouchers?.voucher_types?.code ?? "—",
        narration: posting.vouchers?.narration ?? "—",
        debit: decimalUnits(posting.debit_amount),
        credit: decimalUnits(posting.credit_amount),
      }));
    const statementMovements = partyMovementsFromStatementLines(
      bankStatementLines,
      companyId,
      partyId,
    );
    const partyMovements = [...postedMovements, ...statementMovements];
    if (partyId) {
      const selected = partyOptions.find((party) => party.id === partyId);
      const opening = partyMovements
        .filter((row) => Boolean(fromDate) && row.date < fromDate)
        .reduce((sum, row) => sum + row.debit - row.credit, 0n);
      const periodRows = partyMovements
        .filter(
          (row) =>
            (!fromDate || row.date >= fromDate) &&
            (!toDate || row.date <= toDate),
        )
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) || a.voucher.localeCompare(b.voucher),
        );
      const totals = periodRows.reduce(
        (sum, row) => ({
          debit: sum.debit + row.debit,
          credit: sum.credit + row.credit,
        }),
        { debit: 0n, credit: 0n },
      );
      const accumulator = { balance: opening };
      const detailRows: React.ReactNode[][] = [
        [
          fromDate || "Beginning",
          "—",
          "Opening",
          "—",
          "Opening balance",
          "—",
          "—",
          balanceLabel(opening),
        ],
      ];
      for (const row of periodRows) {
        accumulator.balance += row.debit - row.credit;
        detailRows.push([
          row.date,
          companies.find((company) => company.id === row.companyId)?.code ??
            "—",
          row.voucher,
          row.type,
          row.narration,
          row.debit === 0n ? "—" : formatUnits(row.debit),
          row.credit === 0n ? "—" : formatUnits(row.credit),
          balanceLabel(accumulator.balance),
        ]);
      }
      table = (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm text-[var(--muted)]">Selected party</p>
            <p className="mt-1 text-lg font-semibold">
              {selected ? `${selected.code} — ${selected.name}` : "Party"}
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Includes posted party vouchers and bank-statement rows tagged in
              Paid to / Received from. Debit = paid to party. Credit = received
              from party.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div>
                <p className="text-xs text-[var(--muted)]">Opening</p>
                <p className="font-semibold">{balanceLabel(opening)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Period debit</p>
                <p className="font-semibold">{formatUnits(totals.debit)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Period credit</p>
                <p className="font-semibold">{formatUnits(totals.credit)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Closing</p>
                <p className="font-semibold">
                  {balanceLabel(opening + totals.debit - totals.credit)}
                </p>
              </div>
            </div>
          </div>
          <DataTable
            columns={[
              "Date",
              "Company",
              "Voucher",
              "Type",
              "Narration",
              "Debit",
              "Credit",
              "Running balance",
            ]}
            rows={detailRows}
          />
        </div>
      );
    } else {
      const partyRows = new Map<
        string,
        {
          code: string;
          name: string;
          companies: Set<string>;
          opening: bigint;
          debit: bigint;
          credit: bigint;
        }
      >();
      for (const row of partyMovements) {
        const party = parties.find((item) => item.id === row.partyId);
        const current = partyRows.get(row.partyId) ?? {
          code: party?.code ?? "",
          name: party?.name ?? "Unknown party",
          companies: new Set<string>(),
          opening: 0n,
          debit: 0n,
          credit: 0n,
        };
        current.companies.add(
          companies.find((company) => company.id === row.companyId)?.code ??
            "—",
        );
        const movement = row.debit - row.credit;
        if (fromDate && row.date < fromDate) current.opening += movement;
        else if (
          (!fromDate || row.date >= fromDate) &&
          (!toDate || row.date <= toDate)
        ) {
          current.debit += row.debit;
          current.credit += row.credit;
        }
        partyRows.set(row.partyId, current);
      }
      table = (
        <div className="space-y-3">
          <p className="text-xs text-[var(--muted)]">
            Parties tagged on bank statements in Paid to / Received from appear
            here. Open a party from the Party filter for date-wise ledger.
          </p>
          <DataTable
            columns={[
              "Party",
              "Companies",
              "Opening",
              "Period debit",
              "Period credit",
              "Closing",
            ]}
            rows={Array.from(partyRows.values())
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((row) => [
                `${row.code} — ${row.name}`,
                Array.from(row.companies).sort().join(", "),
                balanceLabel(row.opening),
                formatUnits(row.debit),
                formatUnits(row.credit),
                balanceLabel(row.opening + row.debit - row.credit),
              ])}
          />
        </div>
      );
    }
  } else if (report === "outstanding") {
    const asOfDate = toDate || new Date().toISOString().slice(0, 10);
    const asOf = new Date(`${asOfDate}T00:00:00`);
    const rows = documents
      .filter(
        (document) =>
          (!companyId || document.company_id === companyId) &&
          (!partyId || document.party_id === partyId) &&
          (!fromDate || document.document_date >= fromDate) &&
          (!toDate || document.document_date <= toDate),
      )
      .map((document) => {
        const allocated = document.voucher_allocations.reduce(
          (sum, row) => sum + decimalUnits(row.amount),
          0n,
        );
        const outstanding = decimalUnits(document.total_amount) - allocated;
        const days = Math.floor(
          (asOf.valueOf() -
            new Date(`${document.due_date}T00:00:00`).valueOf()) /
            86400000,
        );
        const ageing =
          outstanding <= 0n
            ? "Settled"
            : days <= 0
              ? "Not due"
              : days <= 30
                ? "0–30"
                : days <= 60
                  ? "31–60"
                  : days <= 90
                    ? "61–90"
                    : "90+";
        return [
          document.companies?.code ?? "—",
          document.parties?.name ?? "—",
          document.document_type,
          document.document_number,
          document.document_date,
          document.due_date,
          formatUnits(decimalUnits(document.total_amount)),
          formatUnits(allocated),
          formatUnits(outstanding),
          ageing,
        ];
      });
    table = (
      <DataTable
        columns={[
          "Company",
          "Party",
          "Type",
          "Invoice",
          "Invoice date",
          "Due date",
          "Total",
          "Allocated",
          "Outstanding",
          "Ageing",
        ]}
        rows={rows}
      />
    );
  } else if (report === "gst") {
    const rows = documents.filter(
      (document) =>
        (!companyId || document.company_id === companyId) &&
        (!partyId || document.party_id === partyId) &&
        (!fromDate || document.document_date >= fromDate) &&
        (!toDate || document.document_date <= toDate),
    );
    table = (
      <DataTable
        columns={[
          "Company",
          "Party",
          "Type",
          "Invoice",
          "Date",
          "Taxable",
          "CGST",
          "SGST",
          "IGST",
          "Cess",
          "TDS",
          "E-way bill",
        ]}
        rows={rows.map((document) => [
          document.companies?.code ?? "—",
          document.parties?.name ?? "—",
          document.document_type,
          document.document_number,
          document.document_date,
          formatMoney(document.taxable_amount),
          formatMoney(document.cgst_amount),
          formatMoney(document.sgst_amount),
          formatMoney(document.igst_amount),
          formatMoney(document.cess_amount),
          formatMoney(document.tds_amount),
          document.eway_bill_no ?? "—",
        ])}
      />
    );
  } else if (report === "commission") {
    const rows = documentLines.filter(
      (line) =>
        line.business_documents &&
        (!companyId || line.business_documents.company_id === companyId) &&
        (!partyId || line.business_documents.party_id === partyId) &&
        (!fromDate || line.business_documents.document_date >= fromDate) &&
        (!toDate || line.business_documents.document_date <= toDate),
    );
    table = (
      <DataTable
        columns={[
          "Company",
          "Invoice",
          "Date",
          "Type",
          "Salesman / Broker",
          "Role",
          "Taxable amount",
          "Commission %",
          "Commission",
        ]}
        rows={rows.map((line) => {
          const document = line.business_documents!;
          const person = line.salesmen;
          const taxable = decimalUnits(line.taxable_amount);
          const rate = decimalUnits(person?.default_commission_pct ?? 0);
          const commission = (taxable * rate + 500000n) / 1000000n;
          return [
            document.companies?.code ?? "—",
            document.document_number,
            document.document_date,
            document.document_type,
            person?.name ?? "—",
            person?.role_type ?? "—",
            formatUnits(taxable),
            `${person?.default_commission_pct ?? 0}%`,
            formatUnits(commission),
          ];
        })}
      />
    );
  } else if (report === "salary") {
    const rows = salaries.filter(
      (salary) =>
        (!companyId || salary.company_id === companyId) &&
        (!partyId || salary.employee_party_id === partyId) &&
        (!fromDate || salary.salary_month >= fromDate) &&
        (!toDate || salary.salary_month <= toDate),
    );
    table = (
      <DataTable
        columns={[
          "Company",
          "Location",
          "Month",
          "Employee",
          "Gross",
          "Deductions",
          "Net",
          "Employer contribution",
          "Status",
        ]}
        rows={rows.map((salary) => [
          salary.companies?.code ?? "—",
          salary.locations?.code ?? "—",
          salary.salary_month,
          salary.parties?.name ?? "—",
          formatMoney(salary.gross_amount),
          formatMoney(salary.deductions),
          formatMoney(salary.net_amount),
          formatMoney(salary.employer_contribution),
          salary.status,
        ])}
      />
    );
  } else if (report === "trading") {
    const direct = ledgerTotals.filter((row) =>
      /trading|direct|sales|purchase/i.test(row.section),
    );
    const income = direct
      .filter((row) => row.nature === "income")
      .reduce((sum, row) => sum + row.credit - row.debit, 0);
    const expense = direct
      .filter((row) => row.nature === "expense")
      .reduce((sum, row) => sum + row.debit - row.credit, 0);
    const gross = income + approvedClosingStock - expense;
    table = (
      <DataTable
        columns={["Trading ledger / component", "Nature", "Amount"]}
        rows={[
          ...direct.map((row) => [
            `${row.code} — ${row.name}`,
            row.nature,
            formatMoney(
              row.nature === "income"
                ? row.credit - row.debit
                : row.debit - row.credit,
            ),
          ]),
          [
            "Approved closing stock",
            "Closing stock",
            formatMoney(approvedClosingStock),
          ],
          ["Gross profit / (loss)", "Result", formatMoney(gross)],
        ]}
      />
    );
  } else if (report === "pnl") {
    const rows = ledgerTotals.filter(
      (row) => row.nature === "income" || row.nature === "expense",
    );
    table = (
      <DataTable
        columns={["Ledger", "Nature", "Amount"]}
        rows={[
          ...rows.map((row) => [
            `${row.code} — ${row.name}`,
            row.nature,
            formatMoney(
              row.nature === "income"
                ? row.credit - row.debit
                : row.debit - row.credit,
            ),
          ]),
          [
            "Net profit / (loss)",
            "Result",
            formatMoney(
              rows.reduce(
                (sum, row) =>
                  sum +
                  (row.nature === "income"
                    ? row.credit - row.debit
                    : -(row.debit - row.credit)),
                0,
              ),
            ),
          ],
        ]}
      />
    );
  } else if (report === "balance") {
    const rows = ledgerTotals.filter((row) =>
      ["asset", "liability", "equity"].includes(row.nature),
    );
    table = (
      <DataTable
        columns={["Ledger", "Nature", "Amount"]}
        rows={rows.map((row) => [
          `${row.code} — ${row.name}`,
          row.nature,
          formatMoney(
            row.nature === "asset"
              ? row.debit - row.credit
              : row.credit - row.debit,
          ),
        ])}
      />
    );
  } else if (report === "sales" || report === "purchase") {
    const code = report === "sales" ? "SALE" : "PUR";
    const rows = scoped.filter(
      (posting) => posting.vouchers?.voucher_types?.code === code,
    );
    table = (
      <DataTable
        columns={["Date", "Voucher", "Ledger", "Party", "Debit", "Credit"]}
        rows={rows.map((posting) => [
          posting.voucher_date,
          posting.voucher_number,
          posting.ledgers?.name ?? "—",
          posting.parties?.name ?? "—",
          Number(posting.debit_amount)
            ? formatMoney(posting.debit_amount)
            : "—",
          Number(posting.credit_amount)
            ? formatMoney(posting.credit_amount)
            : "—",
        ])}
      />
    );
  } else if (report === "cashflow") {
    const categories = [
      "operating",
      "investing",
      "financing",
      "cash_equivalent",
    ];
    table = (
      <DataTable
        columns={["Cash-flow activity", "Net movement"]}
        rows={categories.map((category) => [
          category.replace("_", " "),
          formatMoney(
            ledgerTotals
              .filter((row) => row.cashFlow === category)
              .reduce((sum, row) => sum + row.debit - row.credit, 0),
          ),
        ])}
      />
    );
  } else if (report === "fundflow") {
    const currentAssets = ledgerTotals
      .filter((row) => row.workingCapital === "current_asset")
      .reduce((sum, row) => sum + row.debit - row.credit, 0);
    const currentLiabilities = ledgerTotals
      .filter((row) => row.workingCapital === "current_liability")
      .reduce((sum, row) => sum + row.credit - row.debit, 0);
    table = (
      <DataTable
        columns={["Working-capital component", "Amount"]}
        rows={[
          ["Current assets", formatMoney(currentAssets)],
          ["Current liabilities", formatMoney(currentLiabilities)],
          [
            "Net working capital",
            formatMoney(currentAssets - currentLiabilities),
          ],
        ]}
      />
    );
  } else if (report === "expense") {
    const rows = ledgerTotals.filter((row) => row.nature === "expense");
    table = (
      <DataTable
        columns={["Expense ledger", "Amount"]}
        rows={rows.map((row) => [
          `${row.code} — ${row.name}`,
          formatMoney(row.debit - row.credit),
        ])}
      />
    );
  } else {
    const debitTotal = ledgerTotals.reduce((sum, row) => sum + row.debit, 0);
    const creditTotal = ledgerTotals.reduce((sum, row) => sum + row.credit, 0);
    table = (
      <DataTable
        columns={["Ledger", "Debit", "Credit", "Closing Dr/(Cr)"]}
        rows={[
          ...ledgerTotals.map((row) => [
            `${row.code} — ${row.name}`,
            formatMoney(row.debit),
            formatMoney(row.credit),
            formatMoney(row.debit - row.credit),
          ]),
          [
            "TOTAL",
            formatMoney(debitTotal),
            formatMoney(creditTotal),
            formatMoney(debitTotal - creditTotal),
          ],
        ]}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2 xl:grid-cols-6 print:hidden">
        <Select
          label="Company"
          value={companyId}
          onChange={(event) => {
            const nextCompany = event.target.value;
            setCompanyId(nextCompany);
            setPartyId("");
            setBankAccountId("");
            const fy = indianFinancialYearForDate();
            const match = financialYears.find(
              (year) =>
                year.company_id === nextCompany &&
                year.start_date &&
                year.end_date &&
                year.start_date <= fy.startDate &&
                year.end_date >= fy.startDate,
            );
            setFinancialYearId(match?.id ?? "");
            setFromDate(match?.start_date ?? fy.startDate);
            setToDate(match?.end_date ?? fy.endDate);
          }}
        >
          <option value="">All accessible companies</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.code} — {company.name}
            </option>
          ))}
        </Select>
        <Select
          label="Financial year"
          value={financialYearId}
          onChange={(event) => {
            const nextYearId = event.target.value;
            setFinancialYearId(nextYearId);
            setPartyId("");
            const year = years.find((item) => item.id === nextYearId);
            if (year?.start_date && year.end_date) {
              setFromDate(year.start_date);
              setToDate(year.end_date);
            }
          }}
          disabled={!companyId}
        >
          <option value="">All years</option>
          {years.map((year) => (
            <option key={year.id} value={year.id}>
              {year.code}
            </option>
          ))}
        </Select>
        <Input
          label="From date"
          type="date"
          value={fromDate}
          onChange={(event) => setFromDate(event.target.value)}
        />
        <Input
          label="To date"
          type="date"
          min={fromDate || undefined}
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
        />
        <Select
          label="Party"
          value={partyId}
          onChange={(event) => {
            setPartyId(event.target.value);
            if (event.target.value) setReport("party");
          }}
        >
          <option value="">All parties</option>
          {partyOptions.map((party) => (
            <option key={party.id} value={party.id}>
              {party.code} — {party.name}
            </option>
          ))}
        </Select>
        <Select
          label="Report"
          value={report}
          onChange={(event) =>
            setReport(event.target.value as keyof typeof reportNames)
          }
        >
          {Object.entries(reportNames).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </Select>
      </div>
      {fromDate && toDate && fromDate > toDate ? (
        <p className="text-sm text-[var(--danger)]">
          To date cannot be earlier than From date.
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{reportNames[report]}</h2>
        <ExportButtons title={reportNames[report]} details={exportDetails} />
      </div>
      <div data-report-output>{table}</div>
    </div>
  );
}
