export const BUSY_ACCOUNT_GROUPS: {
  code: string;
  name: string;
  nature: "asset" | "liability" | "equity" | "income" | "expense";
  parentCode: string | null;
  bsPlSection: string;
  cashFlowCategory: "operating" | "investing" | "financing" | "cash_equivalent" | null;
  workingCapitalClass: "current_asset" | "current_liability" | "non_current" | null;
  isIntercompany: boolean;
}[] = [
  { code: "BS-CAP", name: "Capital Account", nature: "equity", parentCode: null, bsPlSection: "Capital Account", cashFlowCategory: "financing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-RES", name: "Reserves & Surplus", nature: "equity", parentCode: "BS-CAP", bsPlSection: "Capital Account", cashFlowCategory: "financing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-PANDL", name: "Profit & Loss A/c", nature: "equity", parentCode: "BS-CAP", bsPlSection: "Capital Account", cashFlowCategory: "financing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-LOAN", name: "Loans (Liability)", nature: "liability", parentCode: null, bsPlSection: "Loans (Liability)", cashFlowCategory: "financing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-BOD", name: "Bank OD A/c", nature: "liability", parentCode: "BS-LOAN", bsPlSection: "Loans (Liability)", cashFlowCategory: "financing", workingCapitalClass: "current_liability", isIntercompany: false },
  { code: "BS-SEC", name: "Secured Loans", nature: "liability", parentCode: "BS-LOAN", bsPlSection: "Loans (Liability)", cashFlowCategory: "financing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-UNSEC", name: "Unsecured Loans", nature: "liability", parentCode: "BS-LOAN", bsPlSection: "Loans (Liability)", cashFlowCategory: "financing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-CL", name: "Current Liabilities", nature: "liability", parentCode: null, bsPlSection: "Current Liabilities", cashFlowCategory: "operating", workingCapitalClass: "current_liability", isIntercompany: false },
  { code: "BS-CRED", name: "Sundry Creditors", nature: "liability", parentCode: "BS-CL", bsPlSection: "Current Liabilities", cashFlowCategory: "operating", workingCapitalClass: "current_liability", isIntercompany: false },
  { code: "BS-DUTY", name: "Duties & Taxes", nature: "liability", parentCode: "BS-CL", bsPlSection: "Current Liabilities", cashFlowCategory: "operating", workingCapitalClass: "current_liability", isIntercompany: false },
  { code: "BS-PROV", name: "Provisions", nature: "liability", parentCode: "BS-CL", bsPlSection: "Current Liabilities", cashFlowCategory: "operating", workingCapitalClass: "current_liability", isIntercompany: false },
  { code: "BS-OUTE", name: "Outstanding Expenses", nature: "liability", parentCode: "BS-CL", bsPlSection: "Current Liabilities", cashFlowCategory: "operating", workingCapitalClass: "current_liability", isIntercompany: false },
  { code: "BS-ADVC", name: "Advance from Customers", nature: "liability", parentCode: "BS-CL", bsPlSection: "Current Liabilities", cashFlowCategory: "operating", workingCapitalClass: "current_liability", isIntercompany: false },
  { code: "BS-STPY", name: "Statutory Payables", nature: "liability", parentCode: "BS-CL", bsPlSection: "Current Liabilities", cashFlowCategory: "operating", workingCapitalClass: "current_liability", isIntercompany: false },
  { code: "BS-ICPAY", name: "Inter-company Payables", nature: "liability", parentCode: "BS-CL", bsPlSection: "Current Liabilities", cashFlowCategory: "operating", workingCapitalClass: "current_liability", isIntercompany: true },
  { code: "BS-FA", name: "Fixed Assets", nature: "asset", parentCode: null, bsPlSection: "Fixed Assets", cashFlowCategory: "investing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-LB", name: "Land & Building", nature: "asset", parentCode: "BS-FA", bsPlSection: "Fixed Assets", cashFlowCategory: "investing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-PM", name: "Plant & Machinery", nature: "asset", parentCode: "BS-FA", bsPlSection: "Fixed Assets", cashFlowCategory: "investing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-FF", name: "Furniture & Fixtures", nature: "asset", parentCode: "BS-FA", bsPlSection: "Fixed Assets", cashFlowCategory: "investing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-VEH", name: "Vehicles", nature: "asset", parentCode: "BS-FA", bsPlSection: "Fixed Assets", cashFlowCategory: "investing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-COMP", name: "Computers & Peripherals", nature: "asset", parentCode: "BS-FA", bsPlSection: "Fixed Assets", cashFlowCategory: "investing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-OE", name: "Office Equipment", nature: "asset", parentCode: "BS-FA", bsPlSection: "Fixed Assets", cashFlowCategory: "investing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-CWIP", name: "Capital Work in Progress", nature: "asset", parentCode: "BS-FA", bsPlSection: "Fixed Assets", cashFlowCategory: "investing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-INV", name: "Investments", nature: "asset", parentCode: null, bsPlSection: "Investments", cashFlowCategory: "investing", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-CA", name: "Current Assets", nature: "asset", parentCode: null, bsPlSection: "Current Assets", cashFlowCategory: "operating", workingCapitalClass: "current_asset", isIntercompany: false },
  { code: "BS-STK", name: "Stock-in-hand", nature: "asset", parentCode: "BS-CA", bsPlSection: "Current Assets", cashFlowCategory: "operating", workingCapitalClass: "current_asset", isIntercompany: false },
  { code: "BS-DEB", name: "Sundry Debtors", nature: "asset", parentCode: "BS-CA", bsPlSection: "Current Assets", cashFlowCategory: "operating", workingCapitalClass: "current_asset", isIntercompany: false },
  { code: "BS-CASH", name: "Cash-in-hand", nature: "asset", parentCode: "BS-CA", bsPlSection: "Current Assets", cashFlowCategory: "cash_equivalent", workingCapitalClass: "current_asset", isIntercompany: false },
  { code: "BS-BANK", name: "Bank Accounts", nature: "asset", parentCode: "BS-CA", bsPlSection: "Current Assets", cashFlowCategory: "cash_equivalent", workingCapitalClass: "current_asset", isIntercompany: false },
  { code: "BS-DEP", name: "Deposits (Asset)", nature: "asset", parentCode: "BS-CA", bsPlSection: "Current Assets", cashFlowCategory: "operating", workingCapitalClass: "current_asset", isIntercompany: false },
  { code: "BS-LNA", name: "Loans & Advances (Asset)", nature: "asset", parentCode: "BS-CA", bsPlSection: "Current Assets", cashFlowCategory: "operating", workingCapitalClass: "current_asset", isIntercompany: false },
  { code: "BS-PREP", name: "Prepaid Expenses", nature: "asset", parentCode: "BS-CA", bsPlSection: "Current Assets", cashFlowCategory: "operating", workingCapitalClass: "current_asset", isIntercompany: false },
  { code: "BS-ICREC", name: "Inter-company Receivables", nature: "asset", parentCode: "BS-CA", bsPlSection: "Current Assets", cashFlowCategory: "operating", workingCapitalClass: "current_asset", isIntercompany: true },
  { code: "BS-MISC", name: "Misc. Expenses (Asset)", nature: "asset", parentCode: null, bsPlSection: "Misc. Expenses (Asset)", cashFlowCategory: "operating", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-PREL", name: "Preliminary Expenses", nature: "asset", parentCode: "BS-MISC", bsPlSection: "Misc. Expenses (Asset)", cashFlowCategory: "operating", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-BR", name: "Branch / Divisions", nature: "asset", parentCode: null, bsPlSection: "Branch / Divisions", cashFlowCategory: "operating", workingCapitalClass: "non_current", isIntercompany: false },
  { code: "BS-SUS", name: "Suspense A/c", nature: "asset", parentCode: null, bsPlSection: "Suspense A/c", cashFlowCategory: "operating", workingCapitalClass: "current_asset", isIntercompany: false },
  { code: "PL-SALE", name: "Sales Accounts", nature: "income", parentCode: null, bsPlSection: "Sales Accounts", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-SRET", name: "Sales Return", nature: "income", parentCode: "PL-SALE", bsPlSection: "Sales Accounts", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-PUR", name: "Purchase Accounts", nature: "expense", parentCode: null, bsPlSection: "Purchase Accounts", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-PRET", name: "Purchase Return", nature: "expense", parentCode: "PL-PUR", bsPlSection: "Purchase Accounts", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-DI", name: "Direct Incomes", nature: "income", parentCode: null, bsPlSection: "Direct Incomes", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-DE", name: "Direct Expenses", nature: "expense", parentCode: null, bsPlSection: "Direct Expenses", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-FRT", name: "Freight Inward", nature: "expense", parentCode: "PL-DE", bsPlSection: "Direct Expenses", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-WAGE", name: "Direct Wages", nature: "expense", parentCode: "PL-DE", bsPlSection: "Direct Expenses", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-II", name: "Indirect Incomes", nature: "income", parentCode: null, bsPlSection: "Indirect Incomes", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-INTI", name: "Interest Received", nature: "income", parentCode: "PL-II", bsPlSection: "Indirect Incomes", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-DISCI", name: "Discount Received", nature: "income", parentCode: "PL-II", bsPlSection: "Indirect Incomes", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-IE", name: "Indirect Expenses", nature: "expense", parentCode: null, bsPlSection: "Indirect Expenses", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-SAL", name: "Salary & Wages", nature: "expense", parentCode: "PL-IE", bsPlSection: "Indirect Expenses", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-RENT", name: "Rent", nature: "expense", parentCode: "PL-IE", bsPlSection: "Indirect Expenses", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-INTP", name: "Interest Paid", nature: "expense", parentCode: "PL-IE", bsPlSection: "Indirect Expenses", cashFlowCategory: "financing", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-DEPX", name: "Depreciation", nature: "expense", parentCode: "PL-IE", bsPlSection: "Indirect Expenses", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-ADMIN", name: "Administrative Expenses", nature: "expense", parentCode: "PL-IE", bsPlSection: "Indirect Expenses", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-SELL", name: "Selling & Distribution", nature: "expense", parentCode: "PL-IE", bsPlSection: "Indirect Expenses", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-BNKCH", name: "Bank Charges", nature: "expense", parentCode: "PL-IE", bsPlSection: "Indirect Expenses", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
  { code: "PL-DISCA", name: "Discount Allowed", nature: "expense", parentCode: "PL-IE", bsPlSection: "Indirect Expenses", cashFlowCategory: "operating", workingCapitalClass: null, isIntercompany: false },
];

type AccountGroupClient = {
  from: (table: "account_groups") => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{ data: { id: string } | null }>;
        };
      };
    };
    insert: (values: Record<string, unknown>) => Promise<{ error: { message: string; code?: string } | null }>;
  };
};

export async function insertBusyAccountGroups(
  supabase: AccountGroupClient | { from: (table: string) => unknown },
  companyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = supabase as AccountGroupClient;
  for (const group of BUSY_ACCOUNT_GROUPS) {
    let parentId: string | null = null;
    if (group.parentCode) {
      const { data: parent } = await client
        .from("account_groups")
        .select("id")
        .eq("company_id", companyId)
        .eq("code", group.parentCode)
        .maybeSingle();
      parentId = parent?.id ?? null;
    }

    const { error } = await client.from("account_groups").insert({
      company_id: companyId,
      parent_id: parentId,
      code: group.code,
      name: group.name,
      nature: group.nature,
      bs_pl_section: group.bsPlSection,
      cash_flow_category: group.cashFlowCategory,
      working_capital_class: group.workingCapitalClass,
      is_intercompany: group.isIntercompany,
    });

    if (error && error.code !== "23505") {
      return { ok: false, error: error.message };
    }
  }
  return { ok: true };
}
