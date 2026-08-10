-- Phase 1: seed roles, system voucher type templates, sample banks
INSERT INTO public.roles (code, name, permissions) VALUES
(
  'data_entry',
  'Data Entry User',
  '{
    "masters.write": false,
    "vouchers.draft": true,
    "vouchers.submit": true,
    "vouchers.approve": false,
    "vouchers.post": false,
    "cash.write": false,
    "bank.import": false,
    "reports.company": true,
    "reports.consolidated": false,
    "users.manage": false,
    "periods.lock": false
  }'::jsonb
),
(
  'cashier',
  'Cashier',
  '{
    "masters.write": false,
    "vouchers.draft": true,
    "vouchers.submit": true,
    "vouchers.approve": false,
    "vouchers.post": false,
    "cash.write": true,
    "bank.import": false,
    "reports.company": false,
    "reports.consolidated": false,
    "users.manage": false,
    "periods.lock": false
  }'::jsonb
),
(
  'accountant',
  'Accountant',
  '{
    "masters.write": true,
    "vouchers.draft": true,
    "vouchers.submit": true,
    "vouchers.approve": false,
    "vouchers.post": false,
    "cash.write": true,
    "bank.import": true,
    "reports.company": true,
    "reports.consolidated": false,
    "users.manage": false,
    "periods.lock": false
  }'::jsonb
),
(
  'approver',
  'Approver',
  '{
    "masters.write": false,
    "vouchers.draft": true,
    "vouchers.submit": true,
    "vouchers.approve": true,
    "vouchers.post": true,
    "cash.write": true,
    "bank.import": true,
    "reports.company": true,
    "reports.consolidated": false,
    "users.manage": false,
    "periods.lock": true
  }'::jsonb
),
(
  'admin',
  'Admin',
  '{
    "masters.write": true,
    "vouchers.draft": true,
    "vouchers.submit": true,
    "vouchers.approve": true,
    "vouchers.post": true,
    "cash.write": true,
    "bank.import": true,
    "reports.company": true,
    "reports.consolidated": true,
    "users.manage": true,
    "periods.lock": true
  }'::jsonb
),
(
  'management',
  'Management',
  '{
    "masters.write": false,
    "vouchers.draft": false,
    "vouchers.submit": false,
    "vouchers.approve": false,
    "vouchers.post": false,
    "cash.write": false,
    "bank.import": false,
    "reports.company": true,
    "reports.consolidated": true,
    "users.manage": false,
    "periods.lock": false
  }'::jsonb
);

INSERT INTO public.banks (code, name) VALUES
  ('HDFC', 'HDFC Bank'),
  ('ICICI', 'ICICI Bank'),
  ('SBI', 'State Bank of India'),
  ('AXIS', 'Axis Bank'),
  ('KOTAK', 'Kotak Mahindra Bank');

-- System voucher type templates (company_id NULL); copied per company on setup
INSERT INTO public.voucher_types (
  company_id, code, name, number_format, requires_location, affects_cash, affects_bank, allow_negative_cash
) VALUES
  (NULL, 'CASH-R', 'Cash Receipt', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', true, true, false, false),
  (NULL, 'CASH-P', 'Cash Payment', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', true, true, false, false),
  (NULL, 'BNK-R', 'Bank Receipt', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', false, false, true, false),
  (NULL, 'BNK-P', 'Bank Payment', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', false, false, true, false),
  (NULL, 'BNK', 'Bank Voucher', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', false, false, true, false),
  (NULL, 'JV', 'Journal Voucher', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, false, false),
  (NULL, 'CONTRA', 'Contra Voucher', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', true, true, true, false),
  (NULL, 'SALE', 'Sales Voucher', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, false, false),
  (NULL, 'PUR', 'Purchase Voucher', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, false, false),
  (NULL, 'OB', 'Opening Balance', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, false, true),
  (NULL, 'ICT', 'Inter-Company Transfer', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, true, false);

CREATE OR REPLACE FUNCTION public.seed_company_voucher_types(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.voucher_types (
    company_id, code, name, number_format, requires_location, affects_cash, affects_bank, allow_negative_cash
  )
  SELECT
    p_company_id, code, name, number_format, requires_location, affects_cash, affects_bank, allow_negative_cash
  FROM public.voucher_types
  WHERE company_id IS NULL
  ON CONFLICT (company_id, code) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_monthly_periods(p_financial_year_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fy public.financial_years%ROWTYPE;
  v_start date;
  v_end date;
  v_period int := 1;
  v_month_start date;
  v_month_end date;
BEGIN
  SELECT * INTO v_fy FROM public.financial_years WHERE id = p_financial_year_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Financial year not found';
  END IF;

  v_month_start := date_trunc('month', v_fy.start_date)::date;
  IF v_month_start < v_fy.start_date THEN
    v_month_start := v_fy.start_date;
  END IF;

  WHILE v_month_start <= v_fy.end_date LOOP
    v_month_end := (date_trunc('month', v_month_start) + interval '1 month - 1 day')::date;
    IF v_month_end > v_fy.end_date THEN
      v_month_end := v_fy.end_date;
    END IF;

    INSERT INTO public.accounting_periods (
      financial_year_id, company_id, period_no, start_date, end_date
    ) VALUES (
      v_fy.id, v_fy.company_id, v_period, v_month_start, v_month_end
    )
    ON CONFLICT (financial_year_id, period_no) DO NOTHING;

    v_period := v_period + 1;
    v_month_start := (date_trunc('month', v_month_start) + interval '1 month')::date;
    IF v_month_start < v_fy.start_date THEN
      v_month_start := v_fy.start_date;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_company_voucher_types(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_monthly_periods(uuid) TO authenticated;
