-- SundayMD demo data
-- Safe to run more than once. Uses clearly marked DEMO records only.
-- Run after all migrations and after creating admin@testaccount.com.

DO $$
DECLARE
  v_admin uuid;
  v_group uuid;
  v_company_a uuid;
  v_company_b uuid;
  v_fy_a uuid;
  v_fy_b uuid;
  v_loc_a_hq uuid;
  v_loc_a_branch uuid;
  v_loc_b_hq uuid;
  v_party_customer uuid;
  v_party_supplier uuid;
  v_bank_hdfc uuid;
  v_bank_icici uuid;
  v_bank_sbi uuid;
  v_group_asset_a uuid;
  v_group_liability_a uuid;
  v_group_equity_a uuid;
  v_group_income_a uuid;
  v_group_expense_a uuid;
  v_group_asset_b uuid;
  v_group_liability_b uuid;
  v_group_equity_b uuid;
  v_cash_a_hq uuid;
  v_cash_a_branch uuid;
  v_cash_b_hq uuid;
  v_bank_a_hdfc_ledger uuid;
  v_bank_a_icici_ledger uuid;
  v_bank_a_sbi_ledger uuid;
  v_bank_b_hdfc_ledger uuid;
  v_bank_b_icici_ledger uuid;
  v_capital_a uuid;
  v_capital_b uuid;
  v_sales_a uuid;
  v_expense_a uuid;
  v_customer_a uuid;
  v_customer_b uuid;
  v_supplier_a uuid;
  v_supplier_b uuid;
  v_ic_receivable_b uuid;
  v_ic_payable_a uuid;
  v_type uuid;
  v_voucher uuid;
  v_status text;
  v_transfer uuid;
BEGIN
  SELECT id INTO v_admin
  FROM public.profiles
  WHERE lower(email) = lower('admin@testaccount.com');

  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Create admin@testaccount.com before running demo seed';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.company_groups (code, name)
  VALUES ('DEMO-GRP', 'SundayMD Demo Group')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_group;

  INSERT INTO public.companies (group_id, code, name, legal_name, state_code, pan)
  VALUES (v_group, 'DEMO-A', 'Demo Trading Company', 'Demo Trading Company Private Limited', '07', 'DEMOT1234A')
  ON CONFLICT (group_id, code) DO UPDATE SET name = EXCLUDED.name, legal_name = EXCLUDED.legal_name
  RETURNING id INTO v_company_a;

  INSERT INTO public.companies (group_id, code, name, legal_name, state_code, pan)
  VALUES (v_group, 'DEMO-B', 'Demo Services Company', 'Demo Services Company Private Limited', '09', 'DEMOS5678B')
  ON CONFLICT (group_id, code) DO UPDATE SET name = EXCLUDED.name, legal_name = EXCLUDED.legal_name
  RETURNING id INTO v_company_b;

  INSERT INTO public.user_company_access (user_id, company_id, can_read, can_write, can_approve, can_manage)
  VALUES
    (v_admin, v_company_a, true, true, true, true),
    (v_admin, v_company_b, true, true, true, true)
  ON CONFLICT (user_id, company_id) DO UPDATE SET
    can_read = true, can_write = true, can_approve = true, can_manage = true;

  INSERT INTO public.parties (group_id, code, name, party_kinds, state_code)
  VALUES (v_group, 'DEMO-CUST-001', 'Sharma Traders (Demo)', ARRAY['customer'], '07')
  ON CONFLICT (group_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_party_customer;

  INSERT INTO public.parties (group_id, code, name, party_kinds, state_code)
  VALUES (v_group, 'DEMO-SUPP-001', 'Metro Suppliers (Demo)', ARRAY['supplier'], '09')
  ON CONFLICT (group_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_party_supplier;

  INSERT INTO public.party_aliases (party_id, alias_text, normalized_alias, source, confirmed)
  VALUES
    (v_party_customer, 'SHARMA TRADERS NEFT', 'sharma traders neft', 'bank_import', true),
    (v_party_supplier, 'METRO SUPPLIERS UPI', 'metro suppliers upi', 'bank_import', true)
  ON CONFLICT (party_id, normalized_alias) DO UPDATE SET confirmed = true;

  SELECT id INTO v_bank_hdfc FROM public.banks WHERE code = 'HDFC';
  SELECT id INTO v_bank_icici FROM public.banks WHERE code = 'ICICI';
  SELECT id INTO v_bank_sbi FROM public.banks WHERE code = 'SBI';

  INSERT INTO public.account_groups (company_id, code, name, nature, bs_pl_section)
  VALUES (v_company_a, 'DEMO-ASSET', 'Assets', 'asset', 'Assets')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_group_asset_a;
  INSERT INTO public.account_groups (company_id, code, name, nature, bs_pl_section)
  VALUES (v_company_a, 'DEMO-LIAB', 'Liabilities', 'liability', 'Liabilities')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_group_liability_a;
  INSERT INTO public.account_groups (company_id, code, name, nature, bs_pl_section)
  VALUES (v_company_a, 'DEMO-EQUITY', 'Capital', 'equity', 'Equity')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_group_equity_a;
  INSERT INTO public.account_groups (company_id, code, name, nature, bs_pl_section)
  VALUES (v_company_a, 'DEMO-INCOME', 'Income', 'income', 'Profit and Loss')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_group_income_a;
  INSERT INTO public.account_groups (company_id, code, name, nature, bs_pl_section)
  VALUES (v_company_a, 'DEMO-EXPENSE', 'Expenses', 'expense', 'Profit and Loss')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_group_expense_a;

  INSERT INTO public.account_groups (company_id, code, name, nature, bs_pl_section)
  VALUES (v_company_b, 'DEMO-ASSET', 'Assets', 'asset', 'Assets')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_group_asset_b;
  INSERT INTO public.account_groups (company_id, code, name, nature, bs_pl_section)
  VALUES (v_company_b, 'DEMO-LIAB', 'Liabilities', 'liability', 'Liabilities')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_group_liability_b;
  INSERT INTO public.account_groups (company_id, code, name, nature, bs_pl_section)
  VALUES (v_company_b, 'DEMO-EQUITY', 'Capital', 'equity', 'Equity')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_group_equity_b;

  -- Company A ledgers
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_a, v_group_asset_a, 'DEMO-CASH-HQ', 'Head Office Cash', 'cash')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_cash_a_hq;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_a, v_group_asset_a, 'DEMO-CASH-BR', 'Branch Cash', 'cash')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_cash_a_branch;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_a, v_group_asset_a, 'DEMO-BANK-HDFC', 'HDFC Current Account', 'bank')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_bank_a_hdfc_ledger;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_a, v_group_asset_a, 'DEMO-BANK-ICICI', 'ICICI Current Account', 'bank')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_bank_a_icici_ledger;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_a, v_group_asset_a, 'DEMO-BANK-SBI', 'SBI Current Account', 'bank')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_bank_a_sbi_ledger;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_a, v_group_equity_a, 'DEMO-CAPITAL', 'Share Capital', 'general')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_capital_a;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_a, v_group_income_a, 'DEMO-SALES', 'Sales Account', 'general')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_sales_a;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_a, v_group_expense_a, 'DEMO-OFFICE-EXP', 'Office Expenses', 'general')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_expense_a;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type, party_id)
  VALUES (v_company_a, v_group_asset_a, 'DEMO-CUSTOMER', 'Sharma Traders', 'party', v_party_customer)
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, party_id = EXCLUDED.party_id
  RETURNING id INTO v_customer_a;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type, party_id)
  VALUES (v_company_a, v_group_liability_a, 'DEMO-SUPPLIER', 'Metro Suppliers', 'party', v_party_supplier)
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, party_id = EXCLUDED.party_id
  RETURNING id INTO v_supplier_a;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type, counterpart_company_id, is_intercompany)
  VALUES (v_company_a, v_group_asset_a, 'DEMO-IC-REC-B', 'Receivable from Demo Services', 'intercompany_receivable', v_company_b, true)
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_ic_receivable_b;

  -- Company B ledgers
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_b, v_group_asset_b, 'DEMO-CASH-HQ', 'Head Office Cash', 'cash')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_cash_b_hq;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_b, v_group_asset_b, 'DEMO-BANK-HDFC', 'HDFC Current Account', 'bank')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_bank_b_hdfc_ledger;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_b, v_group_asset_b, 'DEMO-BANK-ICICI', 'ICICI Current Account', 'bank')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_bank_b_icici_ledger;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type)
  VALUES (v_company_b, v_group_equity_b, 'DEMO-CAPITAL', 'Share Capital', 'general')
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_capital_b;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type, party_id)
  VALUES (v_company_b, v_group_asset_b, 'DEMO-CUSTOMER', 'Sharma Traders', 'party', v_party_customer)
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, party_id = EXCLUDED.party_id
  RETURNING id INTO v_customer_b;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type, party_id)
  VALUES (v_company_b, v_group_liability_b, 'DEMO-SUPPLIER', 'Metro Suppliers', 'party', v_party_supplier)
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, party_id = EXCLUDED.party_id
  RETURNING id INTO v_supplier_b;
  INSERT INTO public.ledgers (company_id, account_group_id, code, name, ledger_type, counterpart_company_id, is_intercompany)
  VALUES (v_company_b, v_group_liability_b, 'DEMO-IC-PAY-A', 'Payable to Demo Trading', 'intercompany_payable', v_company_a, true)
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_ic_payable_a;

  INSERT INTO public.party_company_links (party_id, company_id, ledger_id, credit_limit)
  VALUES
    (v_party_customer, v_company_a, v_customer_a, 500000),
    (v_party_customer, v_company_b, v_customer_b, 300000),
    (v_party_supplier, v_company_a, v_supplier_a, 400000),
    (v_party_supplier, v_company_b, v_supplier_b, 250000)
  ON CONFLICT (party_id, company_id) DO UPDATE SET ledger_id = EXCLUDED.ledger_id, credit_limit = EXCLUDED.credit_limit;

  INSERT INTO public.locations (company_id, code, name, location_type, is_cash_location, cash_ledger_id)
  VALUES (v_company_a, 'DEMO-HO', 'Delhi Head Office', 'branch', true, v_cash_a_hq)
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, is_cash_location = true, cash_ledger_id = EXCLUDED.cash_ledger_id
  RETURNING id INTO v_loc_a_hq;
  INSERT INTO public.locations (company_id, code, name, location_type, is_cash_location, cash_ledger_id)
  VALUES (v_company_a, 'DEMO-BR1', 'Noida Branch', 'branch', true, v_cash_a_branch)
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, is_cash_location = true, cash_ledger_id = EXCLUDED.cash_ledger_id
  RETURNING id INTO v_loc_a_branch;
  INSERT INTO public.locations (company_id, code, name, location_type, is_cash_location, cash_ledger_id)
  VALUES (v_company_b, 'DEMO-HO', 'Lucknow Head Office', 'branch', true, v_cash_b_hq)
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, is_cash_location = true, cash_ledger_id = EXCLUDED.cash_ledger_id
  RETURNING id INTO v_loc_b_hq;

  INSERT INTO public.user_location_access (user_id, location_id, can_read, can_write)
  VALUES
    (v_admin, v_loc_a_hq, true, true),
    (v_admin, v_loc_a_branch, true, true),
    (v_admin, v_loc_b_hq, true, true)
  ON CONFLICT (user_id, location_id) DO UPDATE SET can_read = true, can_write = true;

  INSERT INTO public.bank_accounts (company_id, bank_id, ledger_id, account_name, account_number, ifsc, account_type)
  VALUES
    (v_company_a, v_bank_hdfc, v_bank_a_hdfc_ledger, 'Demo Trading HDFC', 'DEMO-A-HDFC-001', 'HDFC0000001', 'current'),
    (v_company_a, v_bank_icici, v_bank_a_icici_ledger, 'Demo Trading ICICI', 'DEMO-A-ICICI-001', 'ICIC0000001', 'current'),
    (v_company_a, v_bank_sbi, v_bank_a_sbi_ledger, 'Demo Trading SBI', 'DEMO-A-SBI-001', 'SBIN0000001', 'current'),
    (v_company_b, v_bank_hdfc, v_bank_b_hdfc_ledger, 'Demo Services HDFC', 'DEMO-B-HDFC-001', 'HDFC0000002', 'current'),
    (v_company_b, v_bank_icici, v_bank_b_icici_ledger, 'Demo Services ICICI', 'DEMO-B-ICICI-001', 'ICIC0000002', 'current')
  ON CONFLICT (company_id, account_number) DO UPDATE SET account_name = EXCLUDED.account_name, ifsc = EXCLUDED.ifsc;

  INSERT INTO public.financial_years (company_id, code, start_date, end_date)
  VALUES (v_company_a, '2026-27', DATE '2026-04-01', DATE '2027-03-31')
  ON CONFLICT (company_id, code) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date
  RETURNING id INTO v_fy_a;
  INSERT INTO public.financial_years (company_id, code, start_date, end_date)
  VALUES (v_company_b, '2026-27', DATE '2026-04-01', DATE '2027-03-31')
  ON CONFLICT (company_id, code) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date
  RETURNING id INTO v_fy_b;

  PERFORM public.seed_company_voucher_types(v_company_a);
  PERFORM public.seed_company_voucher_types(v_company_b);
  PERFORM public.create_monthly_periods(v_fy_a);
  PERFORM public.create_monthly_periods(v_fy_b);

  -- A: approved and posted opening balance.
  SELECT id, status INTO v_voucher, v_status FROM public.vouchers
  WHERE company_id = v_company_a AND draft_ref = 'DEMO-A-OB-202627';
  IF v_voucher IS NULL THEN
    SELECT id INTO v_type FROM public.voucher_types WHERE company_id = v_company_a AND code = 'OB';
    INSERT INTO public.vouchers (company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, narration, created_by)
    VALUES (v_company_a, v_fy_a, v_type, DATE '2026-04-01', 'DEMO-A-OB-202627', 'Demo opening balances', v_admin)
    RETURNING id INTO v_voucher;
    INSERT INTO public.voucher_lines (voucher_id, line_no, company_id, location_id, financial_year_id, ledger_id, debit_amount, credit_amount, narration)
    VALUES
      (v_voucher, 1, v_company_a, v_loc_a_hq, v_fy_a, v_cash_a_hq, 50000, 0, 'Opening cash - Head Office'),
      (v_voucher, 2, v_company_a, v_loc_a_branch, v_fy_a, v_cash_a_branch, 25000, 0, 'Opening cash - Branch'),
      (v_voucher, 3, v_company_a, NULL, v_fy_a, v_bank_a_hdfc_ledger, 200000, 0, 'Opening HDFC bank'),
      (v_voucher, 4, v_company_a, NULL, v_fy_a, v_capital_a, 0, 275000, 'Opening capital');
    PERFORM public.approve_voucher(v_voucher);
    PERFORM public.post_voucher(v_voucher);
  END IF;

  -- B: approved and posted opening balance.
  SELECT id, status INTO v_voucher, v_status FROM public.vouchers
  WHERE company_id = v_company_b AND draft_ref = 'DEMO-B-OB-202627';
  IF v_voucher IS NULL THEN
    SELECT id INTO v_type FROM public.voucher_types WHERE company_id = v_company_b AND code = 'OB';
    INSERT INTO public.vouchers (company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, narration, created_by)
    VALUES (v_company_b, v_fy_b, v_type, DATE '2026-04-01', 'DEMO-B-OB-202627', 'Demo opening balances', v_admin)
    RETURNING id INTO v_voucher;
    INSERT INTO public.voucher_lines (voucher_id, line_no, company_id, location_id, financial_year_id, ledger_id, debit_amount, credit_amount, narration)
    VALUES
      (v_voucher, 1, v_company_b, v_loc_b_hq, v_fy_b, v_cash_b_hq, 30000, 0, 'Opening cash - Head Office'),
      (v_voucher, 2, v_company_b, NULL, v_fy_b, v_bank_b_icici_ledger, 120000, 0, 'Opening ICICI bank'),
      (v_voucher, 3, v_company_b, NULL, v_fy_b, v_capital_b, 0, 150000, 'Opening capital');
    PERFORM public.approve_voucher(v_voucher);
    PERFORM public.post_voucher(v_voucher);
  END IF;

  -- A: cash receipt from a shared party.
  SELECT id INTO v_voucher FROM public.vouchers WHERE company_id = v_company_a AND draft_ref = 'DEMO-A-CASH-R-001';
  IF v_voucher IS NULL THEN
    SELECT id INTO v_type FROM public.voucher_types WHERE company_id = v_company_a AND code = 'CASH-R';
    INSERT INTO public.vouchers (company_id, location_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, party_id, narration, created_by)
    VALUES (v_company_a, v_loc_a_hq, v_fy_a, v_type, DATE '2026-08-05', 'DEMO-A-CASH-R-001', v_party_customer, 'Cash received from Sharma Traders', v_admin)
    RETURNING id INTO v_voucher;
    INSERT INTO public.voucher_lines (voucher_id, line_no, company_id, location_id, financial_year_id, ledger_id, party_id, debit_amount, credit_amount, narration)
    VALUES
      (v_voucher, 1, v_company_a, v_loc_a_hq, v_fy_a, v_cash_a_hq, NULL, 25000, 0, 'Cash received'),
      (v_voucher, 2, v_company_a, v_loc_a_hq, v_fy_a, v_customer_a, v_party_customer, 0, 25000, 'From Sharma Traders');
    PERFORM public.approve_voucher(v_voucher);
    PERFORM public.post_voucher(v_voucher);
  END IF;

  -- A: cash payment for office expense.
  SELECT id INTO v_voucher FROM public.vouchers WHERE company_id = v_company_a AND draft_ref = 'DEMO-A-CASH-P-001';
  IF v_voucher IS NULL THEN
    SELECT id INTO v_type FROM public.voucher_types WHERE company_id = v_company_a AND code = 'CASH-P';
    INSERT INTO public.vouchers (company_id, location_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, narration, created_by)
    VALUES (v_company_a, v_loc_a_hq, v_fy_a, v_type, DATE '2026-08-06', 'DEMO-A-CASH-P-001', 'Office expenses paid in cash', v_admin)
    RETURNING id INTO v_voucher;
    INSERT INTO public.voucher_lines (voucher_id, line_no, company_id, location_id, financial_year_id, ledger_id, debit_amount, credit_amount, narration)
    VALUES
      (v_voucher, 1, v_company_a, v_loc_a_hq, v_fy_a, v_expense_a, 5000, 0, 'Office expenses'),
      (v_voucher, 2, v_company_a, v_loc_a_hq, v_fy_a, v_cash_a_hq, 0, 5000, 'Cash paid');
    PERFORM public.approve_voucher(v_voucher);
    PERFORM public.post_voucher(v_voucher);
  END IF;

  -- B: cash receipt from the same shared party.
  SELECT id INTO v_voucher FROM public.vouchers WHERE company_id = v_company_b AND draft_ref = 'DEMO-B-CASH-R-001';
  IF v_voucher IS NULL THEN
    SELECT id INTO v_type FROM public.voucher_types WHERE company_id = v_company_b AND code = 'CASH-R';
    INSERT INTO public.vouchers (company_id, location_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, party_id, narration, created_by)
    VALUES (v_company_b, v_loc_b_hq, v_fy_b, v_type, DATE '2026-08-07', 'DEMO-B-CASH-R-001', v_party_customer, 'Cash received from Sharma Traders by Demo Services', v_admin)
    RETURNING id INTO v_voucher;
    INSERT INTO public.voucher_lines (voucher_id, line_no, company_id, location_id, financial_year_id, ledger_id, party_id, debit_amount, credit_amount, narration)
    VALUES
      (v_voucher, 1, v_company_b, v_loc_b_hq, v_fy_b, v_cash_b_hq, NULL, 18000, 0, 'Cash received'),
      (v_voucher, 2, v_company_b, v_loc_b_hq, v_fy_b, v_customer_b, v_party_customer, 0, 18000, 'From Sharma Traders');
    PERFORM public.approve_voucher(v_voucher);
    PERFORM public.post_voucher(v_voucher);
  END IF;

  -- One linked inter-company transfer, represented by one group transfer and two balanced vouchers.
  SELECT id INTO v_transfer FROM public.intercompany_transfers
  WHERE group_id = v_group AND utr_reference = 'DEMO-IC-UTR-001'
  ORDER BY created_at LIMIT 1;
  IF v_transfer IS NULL THEN
    INSERT INTO public.intercompany_transfers (group_id, from_company_id, to_company_id, amount, transfer_date, utr_reference)
    VALUES (v_group, v_company_a, v_company_b, 15000, DATE '2026-08-08', 'DEMO-IC-UTR-001')
    RETURNING id INTO v_transfer;
  END IF;

  SELECT id INTO v_voucher FROM public.vouchers WHERE company_id = v_company_a AND draft_ref = 'DEMO-A-ICT-001';
  IF v_voucher IS NULL THEN
    SELECT id INTO v_type FROM public.voucher_types WHERE company_id = v_company_a AND code = 'ICT';
    INSERT INTO public.vouchers (company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, narration, external_ref, created_by, intercompany_transfer_id)
    VALUES (v_company_a, v_fy_a, v_type, DATE '2026-08-08', 'DEMO-A-ICT-001', 'Transfer paid to Demo Services', 'DEMO-IC-UTR-001', v_admin, v_transfer)
    RETURNING id INTO v_voucher;
    INSERT INTO public.voucher_lines (voucher_id, line_no, company_id, financial_year_id, ledger_id, debit_amount, credit_amount, narration)
    VALUES
      (v_voucher, 1, v_company_a, v_fy_a, v_ic_receivable_b, 15000, 0, 'Receivable from Demo Services'),
      (v_voucher, 2, v_company_a, v_fy_a, v_bank_a_hdfc_ledger, 0, 15000, 'Paid through HDFC');
    PERFORM public.approve_voucher(v_voucher);
    PERFORM public.post_voucher(v_voucher);
  END IF;
  UPDATE public.intercompany_transfers SET from_voucher_id = v_voucher WHERE id = v_transfer AND from_voucher_id IS NULL;

  SELECT id INTO v_voucher FROM public.vouchers WHERE company_id = v_company_b AND draft_ref = 'DEMO-B-ICT-001';
  IF v_voucher IS NULL THEN
    SELECT id INTO v_type FROM public.voucher_types WHERE company_id = v_company_b AND code = 'ICT';
    INSERT INTO public.vouchers (company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, narration, external_ref, created_by, intercompany_transfer_id)
    VALUES (v_company_b, v_fy_b, v_type, DATE '2026-08-08', 'DEMO-B-ICT-001', 'Transfer received from Demo Trading', 'DEMO-IC-UTR-001', v_admin, v_transfer)
    RETURNING id INTO v_voucher;
    INSERT INTO public.voucher_lines (voucher_id, line_no, company_id, financial_year_id, ledger_id, debit_amount, credit_amount, narration)
    VALUES
      (v_voucher, 1, v_company_b, v_fy_b, v_bank_b_icici_ledger, 15000, 0, 'Received in ICICI'),
      (v_voucher, 2, v_company_b, v_fy_b, v_ic_payable_a, 0, 15000, 'Payable to Demo Trading');
    PERFORM public.approve_voucher(v_voucher);
    PERFORM public.post_voucher(v_voucher);
  END IF;
  UPDATE public.intercompany_transfers
  SET to_voucher_id = v_voucher, match_status = 'matched', matched_at = now(), matched_by = v_admin
  WHERE id = v_transfer;

  PERFORM public.assert_trial_balance_tied(v_company_a, DATE '2026-08-31');
  PERFORM public.assert_trial_balance_tied(v_company_b, DATE '2026-08-31');
END;
$$;

SELECT
  c.code AS company,
  count(DISTINCT l.id) AS locations,
  count(DISTINCT b.id) AS bank_accounts,
  count(DISTINCT v.id) FILTER (WHERE v.status = 'posted') AS posted_demo_vouchers
FROM public.companies c
LEFT JOIN public.locations l ON l.company_id = c.id AND l.code LIKE 'DEMO-%'
LEFT JOIN public.bank_accounts b ON b.company_id = c.id AND b.account_number LIKE 'DEMO-%'
LEFT JOIN public.vouchers v ON v.company_id = c.id AND v.draft_ref LIKE 'DEMO-%'
WHERE c.code IN ('DEMO-A', 'DEMO-B')
GROUP BY c.code
ORDER BY c.code;
