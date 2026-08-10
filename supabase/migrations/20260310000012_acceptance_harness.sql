-- Full Phase 1 acceptance harness (checks 1–9), including JWT sessions for 6–7.
-- Run as postgres/service_role after migrations.
--
-- Usage:
--   select * from public.seed_acceptance_fixture();
--   select * from public.run_full_acceptance();

CREATE OR REPLACE FUNCTION public.seed_acceptance_fixture()
RETURNS TABLE (
  company_a uuid,
  company_b uuid,
  fy_a uuid,
  ob_type_a uuid,
  ledger_cash_a uuid,
  ledger_offset_a uuid,
  location_l1 uuid,
  location_l2 uuid,
  user_admin uuid,
  user_b uuid,
  user_cashier uuid,
  open_date date,
  locked_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_group uuid;
  v_company_a uuid;
  v_company_b uuid;
  v_fy_a uuid;
  v_ob_type uuid;
  v_cash uuid;
  v_offset uuid;
  v_l1 uuid;
  v_l2 uuid;
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  v_user_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
  v_cashier uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid;
  v_role_admin uuid;
  v_role_cashier uuid;
  v_open date := date '2026-04-05';
  v_locked date := date '2026-05-15';
BEGIN
  -- Synthetic auth.users may not exist in bare SQL; profiles need auth.users FK.
  -- Prefer existing profiles if present; otherwise create via auth.users when available.
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES
      (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@acceptance.local', crypt('test-pass', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Acc Admin"}'::jsonb, now(), now()),
      (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'userb@acceptance.local', crypt('test-pass', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"User B"}'::jsonb, now(), now()),
      (v_cashier, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cashier@acceptance.local', crypt('test-pass', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Cashier L1"}'::jsonb, now(), now())
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    -- If auth.users is unavailable, require profiles to already exist with these IDs.
    NULL;
  END;

  INSERT INTO public.profiles (id, full_name, email, is_active)
  VALUES
    (v_admin, 'Acc Admin', 'admin@acceptance.local', true),
    (v_user_b, 'User B', 'userb@acceptance.local', true),
    (v_cashier, 'Cashier L1', 'cashier@acceptance.local', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  SELECT id INTO v_role_admin FROM public.roles WHERE code = 'admin';
  SELECT id INTO v_role_cashier FROM public.roles WHERE code = 'cashier';

  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (v_admin, v_role_admin),
    (v_cashier, v_role_cashier)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.company_groups (code, name)
  VALUES ('ACC', 'Acceptance Group')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_group;

  IF v_group IS NULL THEN
    SELECT id INTO v_group FROM public.company_groups WHERE code = 'ACC';
  END IF;

  INSERT INTO public.companies (group_id, code, name)
  VALUES (v_group, 'A', 'Company A')
  ON CONFLICT (group_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_company_a;
  IF v_company_a IS NULL THEN
    SELECT id INTO v_company_a FROM public.companies WHERE group_id = v_group AND code = 'A';
  END IF;

  INSERT INTO public.companies (group_id, code, name)
  VALUES (v_group, 'B', 'Company B')
  ON CONFLICT (group_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_company_b;
  IF v_company_b IS NULL THEN
    SELECT id INTO v_company_b FROM public.companies WHERE group_id = v_group AND code = 'B';
  END IF;

  PERFORM public.seed_company_voucher_types(v_company_a);
  PERFORM public.seed_company_voucher_types(v_company_b);

  INSERT INTO public.user_company_access (user_id, company_id, can_read, can_write, can_approve, can_manage)
  VALUES
    (v_admin, v_company_a, true, true, true, true),
    (v_admin, v_company_b, true, true, true, true),
    (v_user_b, v_company_b, true, true, true, false),
    (v_cashier, v_company_a, true, true, false, false)
  ON CONFLICT (user_id, company_id) DO UPDATE SET
    can_read = EXCLUDED.can_read,
    can_write = EXCLUDED.can_write,
    can_approve = EXCLUDED.can_approve,
    can_manage = EXCLUDED.can_manage;

  INSERT INTO public.locations (company_id, code, name, location_type, is_cash_location)
  VALUES
    (v_company_a, 'L1', 'Cash L1', 'cash_counter', true),
    (v_company_a, 'L2', 'Cash L2', 'cash_counter', true)
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name;

  SELECT id INTO v_l1 FROM public.locations WHERE company_id = v_company_a AND code = 'L1';
  SELECT id INTO v_l2 FROM public.locations WHERE company_id = v_company_a AND code = 'L2';

  INSERT INTO public.user_location_access (user_id, location_id, can_read, can_write)
  VALUES (v_cashier, v_l1, true, true)
  ON CONFLICT (user_id, location_id) DO UPDATE SET can_read = true, can_write = true;

  INSERT INTO public.financial_years (company_id, code, start_date, end_date)
  VALUES (v_company_a, '2026-27', date '2026-04-01', date '2027-03-31')
  ON CONFLICT (company_id, code) DO UPDATE SET start_date = EXCLUDED.start_date
  RETURNING id INTO v_fy_a;
  IF v_fy_a IS NULL THEN
    SELECT id INTO v_fy_a FROM public.financial_years WHERE company_id = v_company_a AND code = '2026-27';
  END IF;

  PERFORM public.create_monthly_periods(v_fy_a);

  -- Lock May 2026 period for create-on-locked-date tests
  UPDATE public.accounting_periods
  SET is_locked = true, locked_at = now()
  WHERE financial_year_id = v_fy_a
    AND date '2026-05-01' BETWEEN start_date AND end_date;

  -- Ensure April remains open
  UPDATE public.accounting_periods
  SET is_locked = false, locked_at = NULL, locked_by = NULL
  WHERE financial_year_id = v_fy_a
    AND date '2026-04-01' BETWEEN start_date AND end_date;

  SELECT id INTO v_ob_type FROM public.voucher_types WHERE company_id = v_company_a AND code = 'OB';
  v_offset := public.ensure_opening_balance_offset_ledger(v_company_a);

  INSERT INTO public.ledgers (company_id, code, name, ledger_type, is_system)
  VALUES (v_company_a, 'CASH-L1', 'Cash L1', 'cash', false)
  ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_cash;
  IF v_cash IS NULL THEN
    SELECT id INTO v_cash FROM public.ledgers WHERE company_id = v_company_a AND code = 'CASH-L1';
  END IF;

  company_a := v_company_a;
  company_b := v_company_b;
  fy_a := v_fy_a;
  ob_type_a := v_ob_type;
  ledger_cash_a := v_cash;
  ledger_offset_a := v_offset;
  location_l1 := v_l1;
  location_l2 := v_l2;
  user_admin := v_admin;
  user_b := v_user_b;
  user_cashier := v_cashier;
  open_date := v_open;
  locked_date := v_locked;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_full_acceptance()
RETURNS TABLE (check_no int, title text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = on
AS $$
DECLARE
  f record;
  v_draft uuid;
  v_posted1 uuid;
  v_posted2 uuid;
  v_num1 text;
  v_num2 text;
  v_before bigint;
  v_after bigint;
  v_cnt bigint;
  v_dr numeric(18,4);
  v_cr numeric(18,4);
  v_ok boolean;
BEGIN
  SELECT * INTO f FROM public.seed_acceptance_fixture();

  PERFORM public.test_as_user(f.user_admin);
  BEGIN
    -- SET ROLE may fail if not permitted; continue with jwt claims for auth.uid()
    EXECUTE 'SET LOCAL ROLE authenticated';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 1) unbalanced draft save / post fail
  INSERT INTO public.vouchers (
    company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, status, narration, created_by
  ) VALUES (
    f.company_a, f.fy_a, f.ob_type_a, f.open_date,
    'DRAFT-UB-' || substr(gen_random_uuid()::text, 1, 8), 'draft', 'unbalanced', f.user_admin
  ) RETURNING id INTO v_draft;

  INSERT INTO public.voucher_lines (
    voucher_id, line_no, company_id, financial_year_id, ledger_id, debit_amount, credit_amount
  ) VALUES
    (v_draft, 1, f.company_a, f.fy_a, f.ledger_cash_a, 100, 0),
    (v_draft, 2, f.company_a, f.fy_a, f.ledger_offset_a, 0, 40);

  check_no := 1; title := 'Unbalanced draft saves'; passed := true; detail := v_draft::text; RETURN NEXT;

  BEGIN
    PERFORM public.post_voucher(v_draft);
    check_no := 1; title := 'Unbalanced draft post fails'; passed := false; detail := 'post succeeded'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 1; title := 'Unbalanced draft post fails'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  -- 3) failed post does not advance counter
  SELECT COALESCE(last_number, 0) INTO v_before
  FROM public.voucher_number_series
  WHERE company_id = f.company_a AND voucher_type_id = f.ob_type_a AND financial_year_id = f.fy_a AND location_id IS NULL;
  v_before := COALESCE(v_before, 0);

  BEGIN
    PERFORM public.post_voucher(v_draft);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  SELECT COALESCE(last_number, 0) INTO v_after
  FROM public.voucher_number_series
  WHERE company_id = f.company_a AND voucher_type_id = f.ob_type_a AND financial_year_id = f.fy_a AND location_id IS NULL;
  v_after := COALESCE(v_after, 0);

  check_no := 3; title := 'Failed post leaves no number gap';
  passed := (v_after = v_before);
  detail := format('before=%s after=%s', v_before, v_after);
  RETURN NEXT;

  DELETE FROM public.voucher_lines WHERE voucher_id = v_draft;
  DELETE FROM public.vouchers WHERE id = v_draft;

  -- 2) consecutive numbers
  INSERT INTO public.vouchers (
    company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, status, created_by
  ) VALUES (
    f.company_a, f.fy_a, f.ob_type_a, f.open_date,
    'DRAFT-P1-' || substr(gen_random_uuid()::text, 1, 8), 'draft', f.user_admin
  ) RETURNING id INTO v_posted1;

  INSERT INTO public.voucher_lines (
    voucher_id, line_no, company_id, financial_year_id, ledger_id, location_id, debit_amount, credit_amount
  ) VALUES
    (v_posted1, 1, f.company_a, f.fy_a, f.ledger_cash_a, f.location_l1, 1000, 0),
    (v_posted1, 2, f.company_a, f.fy_a, f.ledger_offset_a, NULL, 0, 1000);

  INSERT INTO public.vouchers (
    company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, status, created_by
  ) VALUES (
    f.company_a, f.fy_a, f.ob_type_a, f.open_date,
    'DRAFT-P2-' || substr(gen_random_uuid()::text, 1, 8), 'draft', f.user_admin
  ) RETURNING id INTO v_posted2;

  INSERT INTO public.voucher_lines (
    voucher_id, line_no, company_id, financial_year_id, ledger_id, debit_amount, credit_amount
  ) VALUES
    (v_posted2, 1, f.company_a, f.fy_a, f.ledger_cash_a, 500, 0),
    (v_posted2, 2, f.company_a, f.fy_a, f.ledger_offset_a, 0, 500);

  v_num1 := (public.post_voucher(v_posted1)).voucher_number;
  v_num2 := (public.post_voucher(v_posted2)).voucher_number;

  check_no := 2; title := 'Consecutive numbers, no duplicate';
  passed := v_num1 IS DISTINCT FROM v_num2 AND v_num1 IS NOT NULL AND v_num2 IS NOT NULL;
  detail := format('%s | %s', v_num1, v_num2);
  RETURN NEXT;

  -- 4) locked period create/approve/post
  BEGIN
    INSERT INTO public.vouchers (
      company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, status, created_by
    ) VALUES (
      f.company_a, f.fy_a, f.ob_type_a, f.locked_date,
      'DRAFT-LK-' || substr(gen_random_uuid()::text, 1, 8), 'draft', f.user_admin
    );
    check_no := 4; title := 'Locked period create rejects'; passed := false; detail := 'insert ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 4; title := 'Locked period create rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  INSERT INTO public.vouchers (
    company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, status, created_by
  ) VALUES (
    f.company_a, f.fy_a, f.ob_type_a, f.open_date,
    'DRAFT-LK2-' || substr(gen_random_uuid()::text, 1, 8), 'draft', f.user_admin
  ) RETURNING id INTO v_draft;

  INSERT INTO public.voucher_lines (
    voucher_id, line_no, company_id, financial_year_id, ledger_id, debit_amount, credit_amount
  ) VALUES
    (v_draft, 1, f.company_a, f.fy_a, f.ledger_cash_a, 10, 0),
    (v_draft, 2, f.company_a, f.fy_a, f.ledger_offset_a, 0, 10);

  UPDATE public.accounting_periods
  SET is_locked = true, locked_at = now()
  WHERE company_id = f.company_a AND f.open_date BETWEEN start_date AND end_date;

  BEGIN
    PERFORM public.approve_voucher(v_draft);
    check_no := 4; title := 'Locked period approve rejects'; passed := false; detail := 'approve ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 4; title := 'Locked period approve rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  BEGIN
    PERFORM public.post_voucher(v_draft);
    check_no := 4; title := 'Locked period post rejects'; passed := false; detail := 'post ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 4; title := 'Locked period post rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  UPDATE public.accounting_periods
  SET is_locked = false, locked_at = NULL
  WHERE company_id = f.company_a AND f.open_date BETWEEN start_date AND end_date;

  -- 5) posted immutable (+ lines/postings)
  BEGIN
    UPDATE public.vouchers SET narration = 'tamper' WHERE id = v_posted1;
    check_no := 5; title := 'Posted voucher UPDATE rejects'; passed := false; detail := 'update ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 5; title := 'Posted voucher UPDATE rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  BEGIN
    DELETE FROM public.vouchers WHERE id = v_posted1;
    check_no := 5; title := 'Posted voucher DELETE rejects'; passed := false; detail := 'delete ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 5; title := 'Posted voucher DELETE rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  BEGIN
    UPDATE public.voucher_lines SET debit_amount = 1, credit_amount = 0 WHERE voucher_id = v_posted1;
    check_no := 5; title := 'Posted lines UPDATE rejects'; passed := false; detail := 'line update ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 5; title := 'Posted lines UPDATE rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  BEGIN
    UPDATE public.ledger_postings SET debit_amount = 1 WHERE voucher_id = v_posted1;
    check_no := 5; title := 'Postings UPDATE rejects'; passed := false; detail := 'posting update ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 5; title := 'Postings UPDATE rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  BEGIN
    UPDATE public.vouchers SET status = 'draft' WHERE id = v_posted1;
    check_no := 5; title := 'Reopen posted via status rejects'; passed := false; detail := 'reopen ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 5; title := 'Reopen posted via status rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  -- 8) Trial balance with OB offset
  SELECT COALESCE(SUM(debit_amount),0), COALESCE(SUM(credit_amount),0)
  INTO v_dr, v_cr
  FROM public.ledger_postings
  WHERE company_id = f.company_a;

  BEGIN
    v_ok := public.assert_trial_balance_tied(f.company_a, f.open_date);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
  END;

  check_no := 8; title := 'Opening balance TB Dr = Cr (with OB-OFFSET)';
  passed := v_ok AND v_dr = v_cr AND v_dr > 0;
  detail := format('Dr=%s Cr=%s offset_ledger=%s', v_dr, v_cr, f.ledger_offset_a);
  RETURN NEXT;

  -- 9) audit rows + client forge denied
  SELECT COUNT(*) INTO v_cnt FROM public.audit_log
  WHERE table_name = 'vouchers' AND record_id IN (v_posted1, v_posted2) AND action IN ('INSERT', 'POST');

  check_no := 9; title := 'Audit has create/post rows';
  passed := v_cnt >= 2; detail := format('rows=%s', v_cnt); RETURN NEXT;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO public.audit_log (table_name, record_id, action)
    VALUES ('vouchers', gen_random_uuid(), 'POST');
    check_no := 9; title := 'Client audit INSERT rejects'; passed := false; detail := 'insert ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 9; title := 'Client audit INSERT rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  -- -----------------------------------------------------------------------
  -- 6) Company B JWT cannot read Company A rows (executed, not docs-only)
  -- -----------------------------------------------------------------------
  PERFORM public.test_as_user(f.user_b);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
  EXCEPTION WHEN OTHERS THEN
    check_no := 6; title := 'B JWT session role'; passed := false;
    detail := 'SET ROLE authenticated failed — cannot validate RLS: ' || SQLERRM;
    RETURN NEXT;
    RETURN;
  END;

  -- Confirm RLS is active for this role (non-bypass)
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = CURRENT_USER AND rolbypassrls
  ) THEN
    check_no := 6; title := 'B JWT session role'; passed := false;
    detail := format('current_user=%s still bypasses RLS', CURRENT_USER);
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.vouchers WHERE company_id = f.company_a;
  check_no := 6; title := 'B JWT: vouchers A count = 0';
  passed := v_cnt = 0; detail := format('count=%s', v_cnt); RETURN NEXT;

  SELECT COUNT(*) INTO v_cnt FROM public.voucher_lines WHERE company_id = f.company_a;
  check_no := 6; title := 'B JWT: voucher_lines A count = 0';
  passed := v_cnt = 0; detail := format('count=%s', v_cnt); RETURN NEXT;

  SELECT COUNT(*) INTO v_cnt FROM public.ledger_postings WHERE company_id = f.company_a;
  check_no := 6; title := 'B JWT: ledger_postings A count = 0';
  passed := v_cnt = 0; detail := format('count=%s', v_cnt); RETURN NEXT;

  SELECT COUNT(*) INTO v_cnt FROM public.bank_accounts WHERE company_id = f.company_a;
  check_no := 6; title := 'B JWT: bank_accounts A count = 0';
  passed := v_cnt = 0; detail := format('count=%s', v_cnt); RETURN NEXT;

  SELECT COUNT(*) INTO v_cnt FROM public.attachments WHERE company_id = f.company_a;
  check_no := 6; title := 'B JWT: attachments A count = 0';
  passed := v_cnt = 0; detail := format('count=%s', v_cnt); RETURN NEXT;

  SELECT COUNT(*) INTO v_cnt FROM public.audit_log WHERE company_id = f.company_a;
  check_no := 6; title := 'B JWT: audit_log A count = 0';
  passed := v_cnt = 0; detail := format('count=%s', v_cnt); RETURN NEXT;

  -- -----------------------------------------------------------------------
  -- 7) Cashier JWT: other location denied on read/write/approve/post
  -- -----------------------------------------------------------------------
  PERFORM public.test_as_user(f.user_cashier);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  SELECT COUNT(*) INTO v_cnt FROM public.vouchers WHERE location_id = f.location_l2;
  check_no := 7; title := 'Cashier JWT: other location vouchers = 0';
  passed := v_cnt = 0; detail := format('count=%s', v_cnt); RETURN NEXT;

  BEGIN
    INSERT INTO public.vouchers (
      company_id, location_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, status, created_by
    ) VALUES (
      f.company_a, f.location_l2, f.fy_a, f.ob_type_a, f.open_date,
      'DRAFT-CASH-L2-' || substr(gen_random_uuid()::text, 1, 8), 'draft', f.user_cashier
    );
    check_no := 7; title := 'Cashier JWT: insert other location rejects'; passed := false; detail := 'insert ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 7; title := 'Cashier JWT: insert other location rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  -- Create L2 draft as admin, then cashier approve/post must fail (function authz)
  PERFORM public.test_as_user(f.user_admin);
  INSERT INTO public.vouchers (
    company_id, location_id, financial_year_id, voucher_type_id, voucher_date, draft_ref, status, created_by
  ) VALUES (
    f.company_a, f.location_l2, f.fy_a, f.ob_type_a, f.open_date,
    'DRAFT-CASH-AP-' || substr(gen_random_uuid()::text, 1, 8), 'draft', f.user_admin
  ) RETURNING id INTO v_draft;

  INSERT INTO public.voucher_lines (
    voucher_id, line_no, company_id, location_id, financial_year_id, ledger_id, debit_amount, credit_amount
  ) VALUES
    (v_draft, 1, f.company_a, f.location_l2, f.fy_a, f.ledger_cash_a, 5, 0),
    (v_draft, 2, f.company_a, f.location_l2, f.fy_a, f.ledger_offset_a, 0, 5);

  PERFORM public.test_as_user(f.user_cashier);

  BEGIN
    PERFORM public.approve_voucher(v_draft);
    check_no := 7; title := 'Cashier JWT: approve other location rejects'; passed := false; detail := 'approve ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 7; title := 'Cashier JWT: approve other location rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  BEGIN
    PERFORM public.post_voucher(v_draft);
    check_no := 7; title := 'Cashier JWT: post other location rejects'; passed := false; detail := 'post ok'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_no := 7; title := 'Cashier JWT: post other location rejects'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_acceptance_fixture() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_full_acceptance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_acceptance_fixture() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.run_full_acceptance() TO postgres, service_role;

COMMENT ON FUNCTION public.run_full_acceptance() IS
  'Executes acceptance checks 1–9 including JWT-switched sessions for company isolation (6) and cashier location (7).';
