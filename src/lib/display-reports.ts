export const DISPLAY_REPORTS = [
  { key: "day", label: "Day Book", hint: "Date-wise saari entries" },
  { key: "cash", label: "Cash Ledger", hint: "Cash account ki kitaab" },
  { key: "bank", label: "Bank Ledger", hint: "Bank account ki kitaab" },
  { key: "ledger", label: "Account Ledger", hint: "Har ledger ka running balance" },
  { key: "party", label: "Party Ledger", hint: "Debtor / creditor statement" },
  { key: "trial", label: "Trial Balance", hint: "Debit = Credit check" },
  { key: "trading", label: "Trading Account", hint: "Gross profit" },
  { key: "pnl", label: "Profit & Loss", hint: "Net profit / loss" },
  { key: "balance", label: "Balance Sheet", hint: "Assets = Liabilities" },
  { key: "sales", label: "Sales Register", hint: "Sale bills" },
  { key: "purchase", label: "Purchase Register", hint: "Purchase bills" },
  { key: "outstanding", label: "Outstanding", hint: "Party ageing" },
  { key: "expense", label: "Expense Head-wise", hint: "Kharch ka hisaab" },
  { key: "cashflow", label: "Cash Flow", hint: "Operating / investing / financing" },
  { key: "fundflow", label: "Fund Flow", hint: "Working capital" },
  { key: "gst", label: "GST / TDS / E-way", hint: "Statutory register" },
  { key: "commission", label: "Commission", hint: "Salesman / broker" },
  { key: "salary", label: "Salary Register", hint: "Payroll" },
  { key: "bank_statement", label: "Bank Statement", hint: "Uploaded PDF / Excel" },
] as const;

export type DisplayReportKey = (typeof DISPLAY_REPORTS)[number]["key"];

export const DISPLAY_REPORT_KEYS = DISPLAY_REPORTS.map((item) => item.key);

export function isDisplayReportKey(value: string | null): value is DisplayReportKey {
  return Boolean(value && DISPLAY_REPORT_KEYS.includes(value as DisplayReportKey));
}
