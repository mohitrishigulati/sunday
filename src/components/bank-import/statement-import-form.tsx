"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importBankStatement } from "@/lib/actions/bank-import";
import { Button, DataTable, Input, Select } from "@/components/ui/primitives";
import {
  removeAccountingAttachment,
  uploadAccountingAttachment,
} from "@/lib/attachments";
import { QuickCompanyBankAdd } from "@/components/entries/quick-company-bank-add";
import { formatMoney } from "@/lib/format";
import { validateStatementBalances } from "@/lib/bank-statement-validation";

type SourceFormat = "csv" | "xlsx" | "pdf";
type Row = {
  txnDate: string;
  valueDate?: string;
  description?: string;
  reference?: string;
  transactionType?: string;
  debitAmount: number;
  creditAmount: number;
  balanceAfter?: number;
};

function moneyUnits(value: number): number { return Math.round(value * 10000); }

function amount(value: unknown): number {
  const parsed = Number(
    String(value ?? "")
      .replace(/[₹,\s]/g, "")
      .replace(/\b(dr|cr|debit|credit|wdl|deposit)\b/gi, "")
      .replace(/\((.+)\)/, "-$1"),
  );
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

function signedAmount(value: unknown): number | null {
  const parsed = Number(
    String(value ?? "")
      .replace(/[₹,\s]/g, "")
      .replace(/\b(dr|cr|debit|credit|wdl|deposit)\b/gi, "")
      .replace(/\((.+)\)/, "-$1"),
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHeader(cell: unknown): string {
  return String(cell ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function isDebitHeader(header: string): boolean {
  if (!header) return false;
  if (header.includes("credit") || header.includes("deposit")) return false;
  return (
    header === "dr" ||
    header.includes("debit") ||
    header.includes("withdrawal") ||
    header.includes("withdraw")
  );
}

function isCreditHeader(header: string): boolean {
  if (!header) return false;
  if (header.includes("debit") || header.includes("withdraw")) return false;
  return (
    header === "cr" ||
    header.includes("credit") ||
    header.includes("deposit")
  );
}

function isAmountHeader(header: string): boolean {
  if (!header) return false;
  if (isDebitHeader(header) || isCreditHeader(header)) return false;
  if (header.includes("balance")) return false;
  return (
    header === "amount" ||
    header === "txnamount" ||
    header === "transactionamount" ||
    header === "amt" ||
    header.endsWith("amount") ||
    header.includes("amountinr")
  );
}

function isDrCrTypeHeader(header: string): boolean {
  if (!header) return false;
  return (
    header === "drc" ||
    header === "drcr" ||
    header === "crdr" ||
    header === "debitcredit" ||
    header === "creditdebit" ||
    header === "drcrflag" ||
    header === "cdflag" ||
    header === "debitorcredit" ||
    header === "creditordebit"
  );
}

function isChannelTypeHeader(header: string): boolean {
  if (!header || isDrCrTypeHeader(header)) return false;
  return (
    header === "transactiontype" ||
    header === "txntype" ||
    header === "mode" ||
    header === "channel" ||
    header === "type"
  );
}

function classifyDrCr(value: unknown): "debit" | "credit" | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (/^(dr|debit|wdl|withdrawal|withdraw|d)$/i.test(raw)) return "debit";
  if (/^(cr|credit|dep|deposit|c)$/i.test(raw)) return "credit";
  if (/\b(dr|debit|withdrawal|withdraw)\b/i.test(raw) && !/\b(cr|credit|deposit)\b/i.test(raw))
    return "debit";
  if (/\b(cr|credit|deposit)\b/i.test(raw) && !/\b(dr|debit|withdrawal)\b/i.test(raw))
    return "credit";
  return null;
}

function isoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial dates (approx 1955–2119).
    if (value > 20000 && value < 80000) {
      const utc = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
      return new Date(utc).toISOString().slice(0, 10);
    }
  }
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const numeric = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (numeric) {
    const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3];
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    // Prefer DD/MM/YYYY (India); fall back if month looks invalid.
    if (month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (day >= 1 && day <= 12) {
      return `${year}-${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}`;
    }
  }
  const named = raw.match(/^(\d{1,2})[\/\-.\s]([A-Za-z]{3})[\/\-.\s](\d{2,4})/);
  if (!named) return "";
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  const month = months[named[2].toLowerCase()];
  if (!month) return "";
  const year = named[3].length === 2 ? `20${named[3]}` : named[3];
  return `${year}-${month}-${named[1].padStart(2, "0")}`;
}

function datesIn(value: unknown): string[] {
  if (value instanceof Date || typeof value === "number") {
    const parsed = isoDate(value);
    return parsed ? [parsed] : [];
  }
  const matches =
    String(value ?? "").match(
      /\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.](?:\d{1,2}|[A-Za-z]{3})[\/\-.]\d{2,4}/g,
    ) ?? [];
  return matches.map(isoDate).filter(Boolean);
}

function rowsFromGrid(grid: unknown[][]): Row[] {
  if (grid.length < 2) return [];
  const headerIndex = grid.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    const hasDate = headers.some((header) => header.includes("date"));
    const hasDebit = headers.some(isDebitHeader);
    const hasCredit = headers.some(isCreditHeader);
    const hasAmount = headers.some(isAmountHeader);
    const hasType = headers.some(isDrCrTypeHeader);
    return (
      hasDate &&
      ((hasDebit && hasCredit) ||
        (hasAmount && (hasType || hasDebit || hasCredit)) ||
        hasAmount)
    );
  });
  if (headerIndex < 0) return [];
  const headers = grid[headerIndex].map(normalizeHeader);
  const findIncludes = (...names: string[]) =>
    headers.findIndex((header) =>
      names.some((name) => header === name || header.includes(name)),
    );
  const dateCol = (() => {
    const ranked = [
      "transactiondate",
      "txndate",
      "trandate",
      "txdate",
      "date",
      "valuedate",
    ];
    for (const name of ranked) {
      const index = headers.findIndex(
        (header) =>
          header === name || (name !== "date" && header.includes(name)),
      );
      if (index >= 0) return index;
    }
    return headers.findIndex((header) => header.includes("date"));
  })();
  const valueDate = headers.findIndex(
    (header) => header === "valuedate" || header.includes("valuedate"),
  );
  const particulars = findIncludes(
    "particulars",
    "description",
    "narration",
    "remarks",
    "details",
    "narrative",
  );
  const reference = (() => {
    const ranked = [
      "referenceno",
      "chequeno",
      "chqno",
      "chqrefno",
      "utrnumber",
      "utr",
      "refno",
      "reference",
    ];
    for (const name of ranked) {
      const index = headers.findIndex(
        (header) => header === name || header.includes(name),
      );
      if (index >= 0) return index;
    }
    return headers.findIndex(
      (header) =>
        (header.includes("ref") ||
          header.includes("chq") ||
          header.includes("cheque")) &&
        !header.includes("date"),
    );
  })();
  const drCrCol = headers.findIndex(isDrCrTypeHeader);
  const channelType = headers.findIndex(isChannelTypeHeader);
  const debit = headers.findIndex(isDebitHeader);
  const credit = headers.findIndex(isCreditHeader);
  const amountCol = headers.findIndex(isAmountHeader);
  const balance = (() => {
    const ranked = ["runningbalance", "balance", "closingbalance", "bal"];
    for (const name of ranked) {
      const index = headers.findIndex(
        (header) =>
          header === name ||
          (header.includes(name) && !header.includes("opening")),
      );
      if (index >= 0) return index;
    }
    return -1;
  })();

  const rows: Row[] = [];
  let previousBalance: number | undefined;
  for (const cells of grid.slice(headerIndex + 1)) {
    if (dateCol < 0) continue;
    const combinedDates = datesIn(cells[dateCol]);
    const txnDate = combinedDates[0] ?? isoDate(cells[dateCol]);
    const parsedValueDate =
      valueDate >= 0 && valueDate !== dateCol
        ? isoDate(cells[valueDate])
        : combinedDates[1];

    let debitAmount = debit >= 0 ? amount(cells[debit]) : 0;
    let creditAmount = credit >= 0 ? amount(cells[credit]) : 0;
    const balanceAfter =
      balance >= 0 && cells[balance] !== "" && cells[balance] != null
        ? amount(cells[balance])
        : undefined;

    if (debitAmount === 0 && creditAmount === 0 && amountCol >= 0) {
      const abs = amount(cells[amountCol]);
      const typeHint =
        drCrCol >= 0
          ? classifyDrCr(cells[drCrCol])
          : classifyDrCr(cells[amountCol]);
      const signed = signedAmount(cells[amountCol]);
      if (typeHint === "debit") debitAmount = abs;
      else if (typeHint === "credit") creditAmount = abs;
      else if (
        previousBalance !== undefined &&
        balanceAfter !== undefined &&
        abs > 0
      ) {
        const delta = Number((balanceAfter - previousBalance).toFixed(4));
        if (Math.abs(Math.abs(delta) - abs) < 0.0001) {
          if (delta < 0) debitAmount = abs;
          else if (delta > 0) creditAmount = abs;
        }
      } else if (signed !== null && signed < 0) {
        debitAmount = Math.abs(signed);
      } else if (signed !== null && signed > 0 && drCrCol >= 0) {
        // Only guess positive=credit when an explicit Dr/Cr column exists but cell was empty.
        creditAmount = signed;
      }
    }

    if (balanceAfter !== undefined) previousBalance = balanceAfter;
    if (!txnDate || debitAmount > 0 === creditAmount > 0) continue;

    const channel =
      channelType >= 0
        ? String(cells[channelType] ?? "").trim()
        : drCrCol >= 0
          ? String(cells[drCrCol] ?? "").trim()
          : "";

    rows.push({
      txnDate,
      valueDate: parsedValueDate || undefined,
      description:
        particulars >= 0
          ? String(cells[particulars] ?? "").trim() || undefined
          : undefined,
      reference:
        reference >= 0
          ? String(cells[reference] ?? "").trim() || undefined
          : undefined,
      transactionType: channel || (debitAmount > 0 ? "Debit" : "Credit"),
      debitAmount,
      creditAmount,
      balanceAfter,
    });
  }
  return rows;
}

function parseCsv(text: string): Row[] {
  const grid = text
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const cells: string[] = [];
      let current = "";
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"' && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else if (char === '"') quoted = !quoted;
        else if (char === "," && !quoted) {
          cells.push(current.trim());
          current = "";
        } else current += char;
      }
      cells.push(current.trim());
      return cells;
    });
  return rowsFromGrid(grid);
}

async function parseXlsx(file: File): Promise<Row[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const tryBook = (workbook: {
    SheetNames: string[];
    Sheets: Record<string, object>;
  }) => {
    let best: Row[] = [];
    for (const name of workbook.SheetNames) {
      const grid = XLSX.utils.sheet_to_json<unknown[]>(
        workbook.Sheets[name] as never,
        {
          header: 1,
          raw: true,
          defval: "",
        },
      );
      const rows = rowsFromGrid(grid);
      if (rows.length > best.length) best = rows;
    }
    return best;
  };

  let best: Row[] = [];
  try {
    best = tryBook(
      XLSX.read(buffer, { type: "array", cellDates: true }),
    );
  } catch {
    best = [];
  }

  // Many Indian bank portals download HTML tables named .xls/.xlsx.
  if (best.length === 0) {
    const text = new TextDecoder("utf-8").decode(buffer);
    if (/<html|<table/i.test(text)) {
      try {
        best = tryBook(XLSX.read(text, { type: "string", cellDates: true }));
      } catch {
        /* keep empty */
      }
    }
  }
  return best;
}

async function parsePdf(file: File): Promise<Row[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const rows: Row[] = [];
  let iobOperationalLayout = false;
  for (let pageNo = 1; pageNo <= document.numPages; pageNo += 1) {
    const page = await document.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => {
      if (!("str" in item) || !("transform" in item) || !item.str.trim())
        return [];
      return [
        { text: item.str.trim(), x: item.transform[4], y: item.transform[5] },
      ];
    });

    // IOB's OpTransactionStatement uses Date, Value Date, CHQ, Remarks, COD,
    // Debit, Credit and Balance. CHQ appears before Remarks, unlike the more
    // common particulars-then-reference layout. Remember the layout from page
    // one because later pages do not repeat the table header.
    const pageLabels = new Set(items.map((item) => item.text.toLowerCase()));
    if (
      pageLabels.has("chq") &&
      pageLabels.has("remarks") &&
      pageLabels.has("cod")
    )
      iobOperationalLayout = true;

    // A bank PDF is a positioned table. Only a row with a recognised value in
    // the Transaction Type column can be a transaction. Dates and numbers in
    // report headers, footers and available-balance notes are deliberately ignored.
    const dateEnd = viewport.width * (iobOperationalLayout ? 0.22 : 0.17);
    const referenceFrom = iobOperationalLayout
      ? dateEnd
      : viewport.width * 0.44;
    const referenceEnd = viewport.width * (iobOperationalLayout ? 0.29 : 0.54);
    const particularsFrom = iobOperationalLayout ? referenceEnd : dateEnd;
    const particularsEnd =
      viewport.width * (iobOperationalLayout ? 0.575 : 0.44);
    const typeFrom = iobOperationalLayout ? particularsEnd : referenceEnd;
    const typeEnd = viewport.width * 0.64;
    const debitEnd = viewport.width * 0.755;
    const creditEnd = viewport.width * 0.845;
    const modes =
      /^(transfer|trf|clearing|cash|neft|rtgs|imps|upi|ach|nach|atm|pos|card|cheque|chq)$/i;
    const coreYs = [
      ...new Set(
        items
          .filter(
            (item) =>
              item.x >= typeFrom && item.x < typeEnd && modes.test(item.text),
          )
          .map((item) => Math.round(item.y * 2) / 2),
      ),
    ].sort((a, b) => b - a);

    const columnText = (cluster: typeof items, from: number, to: number) =>
      cluster
        .filter((item) => item.x >= from && item.x < to)
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

    coreYs.forEach((coreY, index) => {
      const upper = index === 0 ? coreY + 18 : (coreYs[index - 1] + coreY) / 2;
      const lower =
        index === coreYs.length - 1
          ? coreY - 18
          : (coreY + coreYs[index + 1]) / 2;
      const cluster = items.filter((item) => item.y < upper && item.y >= lower);
      const core = items.filter((item) => Math.abs(item.y - coreY) <= 1.5);
      const parsedDates = datesIn(columnText(cluster, 0, dateEnd));
      const debitCell = columnText(core, typeEnd, debitEnd);
      const creditCell = columnText(core, debitEnd, creditEnd);
      const balanceCell = columnText(core, creditEnd, viewport.width + 1);
      const debitAmount = debitCell === "-" ? 0 : amount(debitCell);
      const creditAmount = creditCell === "-" ? 0 : amount(creditCell);
      if (
        !parsedDates[0] ||
        debitAmount > 0 === creditAmount > 0 ||
        !balanceCell
      )
        return;

      rows.push({
        txnDate: parsedDates[0],
        valueDate: parsedDates[1],
        description:
          columnText(cluster, particularsFrom, particularsEnd) || undefined,
        reference:
          columnText(cluster, referenceFrom, referenceEnd) || undefined,
        transactionType: columnText(core, typeFrom, typeEnd) || undefined,
        debitAmount,
        creditAmount,
        balanceAfter: amount(balanceCell),
      });
    });
  }
  return rows;
}

export function StatementImportForm({
  companies,
  accounts,
  groups,
  banks,
}: {
  companies: Array<{ id: string; code: string; name: string }>;
  accounts: Array<{
    id: string;
    company_id: string;
    account_name: string;
    account_number: string;
  }>;
  groups: Array<{ id: string; code: string; name: string }>;
  banks: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>("csv");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openingBalance, setOpeningBalance] = useState("");
  const [pending, startTransition] = useTransition();
  const filtered = useMemo(
    () => accounts.filter((account) => account.company_id === companyId),
    [accounts, companyId],
  );
  const balanceValidation = useMemo(
    () =>
      rows.length
        ? validateStatementBalances(
            rows,
            openingBalance.trim() ? Number(openingBalance) : undefined,
          )
        : null,
    [rows, openingBalance],
  );
  const detectedClosing = balanceValidation?.detectedClosing;

  return (
    <div className="space-y-3">
      <QuickCompanyBankAdd
        companies={companies}
        groups={groups}
        banks={banks}
        selectedCompanyId={companyId}
        onCompanyCreated={(id) => {
          setCompanyId(id);
          setBankAccountId("");
        }}
        onBankCreated={(id, createdCompanyId) => {
          setCompanyId(createdCompanyId);
          setBankAccountId(id);
        }}
      />
      <form
        className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-3"
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            setMessage(null);
            if (!selectedFile) {
              setError("Select a statement file");
              return;
            }
            const closingBalanceRaw = String(
              formData.get("closingBalance") ?? "",
            ).trim();
            if (!closingBalanceRaw) {
              setError("Statement closing balance is required");
              return;
            }
            const manualClosing = Number(closingBalanceRaw);
            if (!Number.isFinite(manualClosing)) {
              setError("Enter a valid statement closing balance");
              return;
            }
            if (detectedClosing === undefined) {
              setError("Statement closing balance could not be detected from the uploaded rows");
              return;
            }
            const currentValidation = validateStatementBalances(
              rows,
              formData.get("openingBalance")
                ? Number(formData.get("openingBalance"))
                : undefined,
            );
            if (!currentValidation.valid) {
              setError(
                `Statement running-balance check failed. ${currentValidation.errors.slice(0, 3).join("; ")}`,
              );
              return;
            }
            if (moneyUnits(manualClosing) !== moneyUnits(detectedClosing)) {
              setError(`Manual closing balance does not match statement. Enter ${detectedClosing.toFixed(4)}`);
              return;
            }
            let attachment;
            try {
              attachment = await uploadAccountingAttachment(
                companyId,
                selectedFile,
                "bank-statements",
              );
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not upload statement",
              );
              return;
            }
            const result = await importBankStatement({
              companyId,
              bankAccountId,
              fileName,
              sourceFormat,
              openingBalance: formData.get("openingBalance")
                ? Number(formData.get("openingBalance"))
                : undefined,
              closingBalance: Number(closingBalanceRaw),
              rows,
              attachment,
            });
            if (!result.ok) {
              await removeAccountingAttachment(attachment.storagePath);
              setError(result.error);
              return;
            }
            setMessage(
              `Imported ${result.data.imported}; fingerprint collisions flagged for review ${result.data.duplicatesQueued}; balance ${result.data.balanceMismatch ? "MISMATCH" : "matched"}`,
            );
            router.refresh();
          })
        }
      >
        <Select
          label="Company"
          required
          value={companyId}
          onChange={(event) => {
            setCompanyId(event.target.value);
            setBankAccountId("");
          }}
        >
          <option value="">Select</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.code} — {company.name}
            </option>
          ))}
        </Select>
        <Select
          label="Bank account"
          name="bankAccountId"
          required
          disabled={!companyId}
          value={bankAccountId}
          onChange={(event) => setBankAccountId(event.target.value)}
        >
          <option value="">Select</option>
          {filtered.map((account) => (
            <option key={account.id} value={account.id}>
              {account.account_name} — {account.account_number}
            </option>
          ))}
        </Select>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Statement (CSV, XLSX or PDF)</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.pdf,text/csv,application/pdf"
            required
            className="block w-full"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setError(null);
              setRows([]);
              setSelectedFile(file);
              setFileName(file.name);
              try {
                const extension = file.name.split(".").pop()?.toLowerCase();
                const format: SourceFormat =
                  extension === "pdf"
                    ? "pdf"
                    : extension === "xlsx" || extension === "xls"
                      ? "xlsx"
                      : "csv";
                setSourceFormat(format);
                const parsed =
                  format === "pdf"
                    ? await parsePdf(file)
                    : format === "xlsx"
                      ? await parseXlsx(file)
                      : parseCsv(await file.text());
                setRows(parsed);
                if (!parsed.length)
                  setError(
                    "Statement rows could not be detected. Required: date, particulars/reference, debit or credit, and preferably running balance.",
                  );
                else {
                  const validation = validateStatementBalances(parsed);
                  if (!validation.valid)
                    setError(
                      `Statement running-balance check failed. ${validation.errors.slice(0, 3).join("; ")}`,
                    );
                }
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Could not read statement",
                );
              }
            }}
          />
        </label>
        <Input
          label="Opening balance (optional)"
          name="openingBalance"
          type="number"
          step="0.0001"
          value={openingBalance}
          onChange={(event) => setOpeningBalance(event.target.value)}
        />
        <div className="space-y-1.5">
          <Input
            label="Statement closing balance *"
            name="closingBalance"
            type="number"
            step="0.0001"
            required
            aria-required="true"
          />
          <p className="text-xs text-[var(--muted)]">
            Detected in statement: {detectedClosing === undefined ? "Not available" : formatMoney(detectedClosing)}
          </p>
        </div>
        <div className="self-end text-sm text-[var(--muted)]">
          {rows.length} transactions ready from {sourceFormat.toUpperCase()}
        </div>
        {error ? (
          <p className="text-sm text-[var(--danger)] md:col-span-3">{error}</p>
        ) : null}
        {message ? (
          <p className="text-sm text-[var(--accent)] md:col-span-3">
            {message}
          </p>
        ) : null}
        <div className="md:col-span-3">
          <Button type="submit" disabled={pending || !rows.length || !balanceValidation?.valid}>
            Import and deduplicate
          </Button>
        </div>
      </form>
      {rows.length ? (
        <section className="space-y-3">
          <div>
            <h3 className="font-semibold">Parsed statement preview</h3>
            <p className="text-sm font-medium text-[var(--accent)]">
              All {rows.length} transactions will be imported.
            </p>
            {balanceValidation ? (
              <p className={balanceValidation.valid ? "text-sm font-medium text-emerald-700" : "text-sm font-medium text-[var(--danger)]"}>
                Running-balance check: {balanceValidation.valid ? `all ${rows.length} rows matched` : `${balanceValidation.errors.length} mismatch(es)`}; order {balanceValidation.direction}; detected opening {balanceValidation.detectedOpening === undefined ? "not available" : formatMoney(balanceValidation.detectedOpening)}.
              </p>
            ) : null}
            <p className="text-xs text-[var(--muted)]">
              For screen speed, the preview table shows only the first {Math.min(rows.length, 100)} rows. Please verify them before importing.
            </p>
          </div>
          <DataTable
            columns={[
              "Statement row",
              "Transaction date",
              "Value date",
              "Particulars",
              "Ref./Cheque No.",
              "Transaction type",
              "Debit (Rs)",
              "Credit (Rs)",
              "Balance (Rs)",
              "Calculated balance",
              "Difference",
              "Check",
            ]}
            rows={rows
              .slice(0, 100)
              .map((row, index) => {
                const check = balanceValidation?.checks[index];
                return [
                index + 1,
                row.txnDate,
                row.valueDate ?? "—",
                row.description ?? "—",
                row.reference ?? "—",
                row.transactionType ??
                  (row.debitAmount > 0 ? "Debit" : "Credit"),
                row.debitAmount ? formatMoney(row.debitAmount) : "—",
                row.creditAmount ? formatMoney(row.creditAmount) : "—",
                row.balanceAfter === undefined
                  ? "—"
                  : formatMoney(row.balanceAfter),
                check?.calculatedBalance === undefined ? "—" : formatMoney(check.calculatedBalance),
                check?.difference === undefined ? "—" : formatMoney(check.difference),
                check?.valid ? "Matched" : check?.message ?? "Not checked",
              ];})}
          />
        </section>
      ) : null}
    </div>
  );
}
