-- Busy-style default account groups (Balance Sheet + P&L heads).
-- Inserts missing groups only; existing company codes are left unchanged.

CREATE OR REPLACE FUNCTION public.seed_company_account_groups(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_parent uuid;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Company is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_capability(p_company_id, 'manage');
  ELSIF NOT (
    current_user IN ('postgres', 'supabase_admin')
    OR pg_has_role(current_user, 'service_role', 'member')
  ) THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  FOR r IN
    SELECT *
    FROM (
      VALUES
        -- Balance Sheet — Capital / Equity
        (10,  'BS-CAP',   'Capital Account',              'equity',    NULL,      'Capital Account',              'financing',        'non_current',         false),
        (11,  'BS-RES',   'Reserves & Surplus',           'equity',    'BS-CAP',  'Capital Account',              'financing',        'non_current',         false),
        (12,  'BS-PANDL', 'Profit & Loss A/c',            'equity',    'BS-CAP',  'Capital Account',              'financing',        'non_current',         false),
        -- Balance Sheet — Loans (Liability)
        (20,  'BS-LOAN',  'Loans (Liability)',            'liability', NULL,      'Loans (Liability)',            'financing',        'non_current',         false),
        (21,  'BS-BOD',   'Bank OD A/c',                  'liability', 'BS-LOAN', 'Loans (Liability)',            'financing',        'current_liability',   false),
        (22,  'BS-SEC',   'Secured Loans',                'liability', 'BS-LOAN', 'Loans (Liability)',            'financing',        'non_current',         false),
        (23,  'BS-UNSEC', 'Unsecured Loans',              'liability', 'BS-LOAN', 'Loans (Liability)',            'financing',        'non_current',         false),
        -- Balance Sheet — Current Liabilities
        (30,  'BS-CL',    'Current Liabilities',          'liability', NULL,      'Current Liabilities',          'operating',        'current_liability',   false),
        (31,  'BS-CRED',  'Sundry Creditors',             'liability', 'BS-CL',   'Current Liabilities',          'operating',        'current_liability',   false),
        (32,  'BS-DUTY',  'Duties & Taxes',               'liability', 'BS-CL',   'Current Liabilities',          'operating',        'current_liability',   false),
        (33,  'BS-PROV',  'Provisions',                   'liability', 'BS-CL',   'Current Liabilities',          'operating',        'current_liability',   false),
        (34,  'BS-OUTE',  'Outstanding Expenses',         'liability', 'BS-CL',   'Current Liabilities',          'operating',        'current_liability',   false),
        (35,  'BS-ADVC',  'Advance from Customers',       'liability', 'BS-CL',   'Current Liabilities',          'operating',        'current_liability',   false),
        (36,  'BS-STPY',  'Statutory Payables',           'liability', 'BS-CL',   'Current Liabilities',          'operating',        'current_liability',   false),
        (37,  'BS-ICPAY', 'Inter-company Payables',       'liability', 'BS-CL',   'Current Liabilities',          'operating',        'current_liability',   true),
        -- Balance Sheet — Fixed Assets
        (40,  'BS-FA',    'Fixed Assets',                 'asset',     NULL,      'Fixed Assets',                 'investing',        'non_current',         false),
        (41,  'BS-LB',    'Land & Building',              'asset',     'BS-FA',   'Fixed Assets',                 'investing',        'non_current',         false),
        (42,  'BS-PM',    'Plant & Machinery',            'asset',     'BS-FA',   'Fixed Assets',                 'investing',        'non_current',         false),
        (43,  'BS-FF',    'Furniture & Fixtures',         'asset',     'BS-FA',   'Fixed Assets',                 'investing',        'non_current',         false),
        (44,  'BS-VEH',   'Vehicles',                     'asset',     'BS-FA',   'Fixed Assets',                 'investing',        'non_current',         false),
        (45,  'BS-COMP',  'Computers & Peripherals',      'asset',     'BS-FA',   'Fixed Assets',                 'investing',        'non_current',         false),
        (46,  'BS-OE',    'Office Equipment',             'asset',     'BS-FA',   'Fixed Assets',                 'investing',        'non_current',         false),
        (47,  'BS-CWIP',  'Capital Work in Progress',     'asset',     'BS-FA',   'Fixed Assets',                 'investing',        'non_current',         false),
        -- Balance Sheet — Investments
        (50,  'BS-INV',   'Investments',                  'asset',     NULL,      'Investments',                  'investing',        'non_current',         false),
        -- Balance Sheet — Current Assets
        (60,  'BS-CA',    'Current Assets',               'asset',     NULL,      'Current Assets',               'operating',        'current_asset',       false),
        (61,  'BS-STK',   'Stock-in-hand',                'asset',     'BS-CA',   'Current Assets',               'operating',        'current_asset',       false),
        (62,  'BS-DEB',   'Sundry Debtors',               'asset',     'BS-CA',   'Current Assets',               'operating',        'current_asset',       false),
        (63,  'BS-CASH',  'Cash-in-hand',                 'asset',     'BS-CA',   'Current Assets',               'cash_equivalent',  'current_asset',       false),
        (64,  'BS-BANK',  'Bank Accounts',                'asset',     'BS-CA',   'Current Assets',               'cash_equivalent',  'current_asset',       false),
        (65,  'BS-DEP',   'Deposits (Asset)',             'asset',     'BS-CA',   'Current Assets',               'operating',        'current_asset',       false),
        (66,  'BS-LNA',   'Loans & Advances (Asset)',     'asset',     'BS-CA',   'Current Assets',               'operating',        'current_asset',       false),
        (67,  'BS-PREP',  'Prepaid Expenses',             'asset',     'BS-CA',   'Current Assets',               'operating',        'current_asset',       false),
        (68,  'BS-ICREC', 'Inter-company Receivables',    'asset',     'BS-CA',   'Current Assets',               'operating',        'current_asset',       true),
        -- Balance Sheet — Other
        (70,  'BS-MISC',  'Misc. Expenses (Asset)',       'asset',     NULL,      'Misc. Expenses (Asset)',       'operating',        'non_current',         false),
        (71,  'BS-PREL',  'Preliminary Expenses',         'asset',     'BS-MISC', 'Misc. Expenses (Asset)',       'operating',        'non_current',         false),
        (80,  'BS-BR',    'Branch / Divisions',           'asset',     NULL,      'Branch / Divisions',           'operating',        'non_current',         false),
        (81,  'BS-SUS',   'Suspense A/c',                 'asset',     NULL,      'Suspense A/c',                 'operating',        'current_asset',       false),
        -- Profit & Loss
        (90,  'PL-SALE',  'Sales Accounts',               'income',    NULL,      'Sales Accounts',               'operating',        NULL,                  false),
        (91,  'PL-SRET',  'Sales Return',                 'income',    'PL-SALE', 'Sales Accounts',               'operating',        NULL,                  false),
        (100, 'PL-PUR',   'Purchase Accounts',            'expense',   NULL,      'Purchase Accounts',            'operating',        NULL,                  false),
        (101, 'PL-PRET',  'Purchase Return',              'expense',   'PL-PUR',  'Purchase Accounts',            'operating',        NULL,                  false),
        (110, 'PL-DI',    'Direct Incomes',               'income',    NULL,      'Direct Incomes',               'operating',        NULL,                  false),
        (120, 'PL-DE',    'Direct Expenses',              'expense',   NULL,      'Direct Expenses',              'operating',        NULL,                  false),
        (121, 'PL-FRT',   'Freight Inward',               'expense',   'PL-DE',   'Direct Expenses',              'operating',        NULL,                  false),
        (122, 'PL-WAGE',  'Direct Wages',                 'expense',   'PL-DE',   'Direct Expenses',              'operating',        NULL,                  false),
        (130, 'PL-II',    'Indirect Incomes',             'income',    NULL,      'Indirect Incomes',             'operating',        NULL,                  false),
        (131, 'PL-INTI',  'Interest Received',            'income',    'PL-II',   'Indirect Incomes',             'operating',        NULL,                  false),
        (132, 'PL-DISCI', 'Discount Received',            'income',    'PL-II',   'Indirect Incomes',             'operating',        NULL,                  false),
        (140, 'PL-IE',    'Indirect Expenses',            'expense',   NULL,      'Indirect Expenses',            'operating',        NULL,                  false),
        (141, 'PL-SAL',   'Salary & Wages',               'expense',   'PL-IE',   'Indirect Expenses',            'operating',        NULL,                  false),
        (142, 'PL-RENT',  'Rent',                         'expense',   'PL-IE',   'Indirect Expenses',            'operating',        NULL,                  false),
        (143, 'PL-INTP',  'Interest Paid',                'expense',   'PL-IE',   'Indirect Expenses',            'financing',        NULL,                  false),
        (144, 'PL-DEPX',  'Depreciation',                 'expense',   'PL-IE',   'Indirect Expenses',            'operating',        NULL,                  false),
        (145, 'PL-ADMIN', 'Administrative Expenses',      'expense',   'PL-IE',   'Indirect Expenses',            'operating',        NULL,                  false),
        (146, 'PL-SELL',  'Selling & Distribution',       'expense',   'PL-IE',   'Indirect Expenses',            'operating',        NULL,                  false),
        (147, 'PL-BNKCH', 'Bank Charges',                 'expense',   'PL-IE',   'Indirect Expenses',            'operating',        NULL,                  false),
        (148, 'PL-DISCA', 'Discount Allowed',             'expense',   'PL-IE',   'Indirect Expenses',            'operating',        NULL,                  false)
    ) AS t(sort, code, name, nature, parent_code, section, cf, wc, ic)
    ORDER BY sort
  LOOP
    v_parent := NULL;
    IF r.parent_code IS NOT NULL THEN
      SELECT id INTO v_parent
      FROM public.account_groups
      WHERE company_id = p_company_id AND code = r.parent_code;
    END IF;

    INSERT INTO public.account_groups (
      company_id, parent_id, code, name, nature, bs_pl_section,
      cash_flow_category, working_capital_class, is_intercompany
    ) VALUES (
      p_company_id,
      v_parent,
      r.code,
      r.name,
      r.nature,
      r.section,
      r.cf,
      r.wc,
      r.ic
    )
    ON CONFLICT (company_id, code) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_company_account_groups(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_company_account_groups(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.seed_company_account_groups(uuid) TO authenticated;

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT id FROM public.companies WHERE deleted_at IS NULL
  LOOP
    PERFORM public.seed_company_account_groups(rec.id);
  END LOOP;
END
$$;
