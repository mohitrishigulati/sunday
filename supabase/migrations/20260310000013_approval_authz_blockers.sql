-- Phase 1 blockers: approval-required post, OB ledger authz, seed helper authz,
-- maker cannot self-approve by default.

-- ---------------------------------------------------------------------------
-- ensure_opening_balance_offset_ledger: require manage on that company
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_opening_balance_offset_ledger(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_capability(p_company_id, 'manage');
  ELSIF NOT (
    current_user IN ('postgres', 'supabase_admin')
    OR pg_has_role(current_user, 'service_role', 'member')
  ) THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT id INTO v_id
  FROM public.ledgers
  WHERE company_id = p_company_id
    AND code = 'OB-OFFSET'
    AND deleted_at IS NULL;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.ledgers (
    company_id, code, name, ledger_type, is_intercompany, is_system, is_active
  ) VALUES (
    p_company_id,
    'OB-OFFSET',
    'Opening Balance Offset',
    'general',
    false,
    true,
    true
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Seed / setup helpers: manage-only (no cross-company create via RPC)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_company_voucher_types(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_capability(p_company_id, 'manage');
  ELSIF NOT (
    current_user IN ('postgres', 'supabase_admin')
    OR pg_has_role(current_user, 'service_role', 'member')
  ) THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

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
  v_period int := 1;
  v_month_start date;
  v_month_end date;
BEGIN
  SELECT * INTO v_fy FROM public.financial_years WHERE id = p_financial_year_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Financial year not found';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_capability(v_fy.company_id, 'manage');
  ELSIF NOT (
    current_user IN ('postgres', 'supabase_admin')
    OR pg_has_role(current_user, 'service_role', 'member')
  ) THEN
    RAISE EXCEPTION 'Authentication required';
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
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_company_voucher_types(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_monthly_periods(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_opening_balance_offset_ledger(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_company_voucher_types(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_monthly_periods(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_opening_balance_offset_ledger(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.seed_company_voucher_types(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_monthly_periods(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_opening_balance_offset_ledger(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- approve_voucher: maker cannot approve own voucher by default
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_voucher(p_voucher_id uuid)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v public.vouchers%ROWTYPE;
  v_self_approve boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required to approve vouchers';
  END IF;

  SELECT * INTO v FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found';
  END IF;

  IF v.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'Cannot approve voucher in status %', v.status;
  END IF;

  PERFORM public.assert_company_capability(v.company_id, 'approve');
  PERFORM public.assert_period_open(v.company_id, v.voucher_date);
  PERFORM public.assert_cashier_location_write(v.location_id);

  IF NOT public.has_permission('vouchers.approve') AND NOT public.user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Missing vouchers.approve permission';
  END IF;

  -- Separation of duties: maker ≠ approver unless admin or explicit self_approve
  v_self_approve := public.has_permission('vouchers.self_approve');
  IF v.created_by IS NOT NULL
     AND v.created_by = auth.uid()
     AND NOT public.user_has_role(ARRAY['admin'])
     AND NOT v_self_approve THEN
    RAISE EXCEPTION 'Maker cannot approve own voucher';
  END IF;

  UPDATE public.vouchers
  SET status = 'approved', approved_by = auth.uid()
  WHERE id = v.id
  RETURNING * INTO v;

  INSERT INTO public.audit_log (actor_id, company_id, table_name, record_id, action, new_row)
  VALUES (auth.uid(), v.company_id, 'vouchers', v.id, 'APPROVE', to_jsonb(v));

  RETURN v;
END;
$$;

-- ---------------------------------------------------------------------------
-- post_voucher: ONLY approved vouchers (no direct draft/submitted post)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_voucher(p_voucher_id uuid)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v public.vouchers%ROWTYPE;
  v_type public.voucher_types%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_fy public.financial_years%ROWTYPE;
  v_location public.locations%ROWTYPE;
  v_series public.voucher_number_series%ROWTYPE;
  v_next bigint;
  v_number text;
  v_line public.voucher_lines%ROWTYPE;
  v_dr numeric(18, 4);
  v_cr numeric(18, 4);
  v_cash numeric(18, 4);
  v_cash_delta numeric(18, 4);
  v_ledger public.ledgers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required to post vouchers';
  END IF;

  SELECT * INTO v FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found';
  END IF;

  IF v.status = 'posted' THEN
    RETURN v;
  END IF;

  -- P0: direct post of draft/submitted must fail — approval required first
  IF v.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Only approved vouchers can be posted (status=%)', v.status;
  END IF;

  PERFORM public.assert_company_capability(v.company_id, 'approve');
  PERFORM public.assert_period_open(v.company_id, v.voucher_date);
  PERFORM public.assert_cashier_location_write(v.location_id);

  IF NOT public.has_permission('vouchers.post') AND NOT public.user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Missing vouchers.post permission';
  END IF;

  SELECT * INTO v_type FROM public.voucher_types WHERE id = v.voucher_type_id;
  SELECT * INTO v_company FROM public.companies WHERE id = v.company_id;
  SELECT * INTO v_fy FROM public.financial_years WHERE id = v.financial_year_id;

  IF v_type.requires_location AND v.location_id IS NULL THEN
    RAISE EXCEPTION 'Voucher type % requires location', v_type.code;
  END IF;

  IF v.location_id IS NOT NULL THEN
    SELECT * INTO v_location FROM public.locations WHERE id = v.location_id;
  END IF;

  SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
  INTO v_dr, v_cr
  FROM public.voucher_lines
  WHERE voucher_id = v.id;

  IF v_dr = 0 OR v_dr <> v_cr THEN
    RAISE EXCEPTION 'Voucher lines must balance before posting (dr % cr %)', v_dr, v_cr;
  END IF;

  IF v_type.affects_cash AND v.location_id IS NOT NULL AND NOT v_type.allow_negative_cash THEN
    v_cash := public.cash_balance(v.location_id, v.voucher_date);
    SELECT COALESCE(SUM(
      CASE WHEN l.ledger_type = 'cash' THEN vl.debit_amount - vl.credit_amount ELSE 0 END
    ), 0)
    INTO v_cash_delta
    FROM public.voucher_lines vl
    JOIN public.ledgers l ON l.id = vl.ledger_id
    WHERE vl.voucher_id = v.id;

    IF v_cash + v_cash_delta < 0 THEN
      RAISE EXCEPTION 'Cash balance would become negative at location %', v.location_id;
    END IF;
  END IF;

  INSERT INTO public.voucher_number_series (
    company_id, location_id, voucher_type_id, financial_year_id, last_number
  )
  VALUES (
    v.company_id,
    CASE WHEN v_type.requires_location THEN v.location_id ELSE NULL END,
    v.voucher_type_id,
    v.financial_year_id,
    0
  )
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_series
  FROM public.voucher_number_series
  WHERE company_id = v.company_id
    AND voucher_type_id = v.voucher_type_id
    AND financial_year_id = v.financial_year_id
    AND location_id IS NOT DISTINCT FROM
      CASE WHEN v_type.requires_location THEN v.location_id ELSE NULL END
  FOR UPDATE;

  v_next := v_series.last_number + 1;
  UPDATE public.voucher_number_series
  SET last_number = v_next
  WHERE id = v_series.id;

  v_number := public.format_voucher_number(
    v_type.number_format,
    v_company.code,
    v_location.code,
    v_type.code,
    v_fy.code,
    v_next
  );

  FOR v_line IN
    SELECT * FROM public.voucher_lines WHERE voucher_id = v.id ORDER BY line_no
  LOOP
    IF v_line.company_id <> v.company_id THEN
      RAISE EXCEPTION 'Voucher line company mismatch';
    END IF;

    SELECT * INTO v_ledger FROM public.ledgers WHERE id = v_line.ledger_id;
    IF v_ledger.company_id <> v.company_id THEN
      RAISE EXCEPTION 'Ledger does not belong to voucher company';
    END IF;

    INSERT INTO public.ledger_postings (
      voucher_id, voucher_line_id, voucher_date, company_id, location_id,
      financial_year_id, ledger_id, party_id, cost_centre_id, salesman_id,
      debit_amount, credit_amount, voucher_number, is_intercompany, intercompany_transfer_id
    ) VALUES (
      v.id, v_line.id, v.voucher_date, v_line.company_id, v_line.location_id,
      v_line.financial_year_id, v_line.ledger_id, v_line.party_id, v_line.cost_centre_id, v_line.salesman_id,
      v_line.debit_amount, v_line.credit_amount, v_number, v_ledger.is_intercompany, v.intercompany_transfer_id
    );
  END LOOP;

  UPDATE public.vouchers
  SET
    status = 'posted',
    voucher_number = v_number,
    posted_at = now(),
    posted_by = auth.uid(),
    approved_by = COALESCE(approved_by, auth.uid())
  WHERE id = v.id
  RETURNING * INTO v;

  INSERT INTO public.audit_log (actor_id, company_id, table_name, record_id, action, new_row, context)
  VALUES (
    auth.uid(), v.company_id, 'vouchers', v.id, 'POST', to_jsonb(v),
    jsonb_build_object('voucher_number', v_number)
  );

  RETURN v;
END;
$$;

-- Reversal: mark approved in-proc then post (does not use approve_voucher / self-approve path)
CREATE OR REPLACE FUNCTION public.reverse_voucher(
  p_voucher_id uuid,
  p_reversal_date date,
  p_narration text DEFAULT NULL
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_orig public.vouchers%ROWTYPE;
  v_rev public.vouchers%ROWTYPE;
  v_line public.voucher_lines%ROWTYPE;
  v_draft text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_orig FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original voucher not found';
  END IF;
  IF v_orig.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted vouchers can be reversed';
  END IF;
  IF v_orig.reversed_by_voucher_id IS NOT NULL THEN
    RAISE EXCEPTION 'Voucher already reversed';
  END IF;

  PERFORM public.assert_company_capability(v_orig.company_id, 'approve');
  PERFORM public.assert_period_open(v_orig.company_id, p_reversal_date);

  IF NOT public.has_permission('vouchers.post') AND NOT public.user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Missing vouchers.post permission';
  END IF;

  v_draft := 'DRAFT-' || substr(gen_random_uuid()::text, 1, 8);

  INSERT INTO public.vouchers (
    company_id, location_id, financial_year_id, voucher_type_id, voucher_date,
    draft_ref, status, party_id, narration, external_ref, currency_code, created_by,
    reversal_of_voucher_id, intercompany_transfer_id, cash_transfer_group_id, contra_group_id
  ) VALUES (
    v_orig.company_id, v_orig.location_id, v_orig.financial_year_id, v_orig.voucher_type_id,
    p_reversal_date, v_draft, 'draft', v_orig.party_id,
    COALESCE(p_narration, 'Reversal of ' || v_orig.voucher_number),
    v_orig.external_ref, v_orig.currency_code, auth.uid(),
    v_orig.id, v_orig.intercompany_transfer_id, v_orig.cash_transfer_group_id, v_orig.contra_group_id
  )
  RETURNING * INTO v_rev;

  FOR v_line IN
    SELECT * FROM public.voucher_lines WHERE voucher_id = v_orig.id ORDER BY line_no
  LOOP
    INSERT INTO public.voucher_lines (
      voucher_id, line_no, company_id, location_id, financial_year_id, ledger_id,
      party_id, cost_centre_id, salesman_id, debit_amount, credit_amount, narration
    ) VALUES (
      v_rev.id, v_line.line_no, v_line.company_id, v_line.location_id, v_line.financial_year_id,
      v_line.ledger_id, v_line.party_id, v_line.cost_centre_id, v_line.salesman_id,
      v_line.credit_amount, v_line.debit_amount, v_line.narration
    );
  END LOOP;

  -- Controlled path: set approved then post (single TX)
  UPDATE public.vouchers
  SET status = 'approved', approved_by = auth.uid()
  WHERE id = v_rev.id;

  v_rev := public.post_voucher(v_rev.id);

  UPDATE public.vouchers
  SET status = 'reversed', reversed_by_voucher_id = v_rev.id
  WHERE id = v_orig.id;

  INSERT INTO public.audit_log (actor_id, company_id, table_name, record_id, action, context)
  VALUES (
    auth.uid(), v_orig.company_id, 'vouchers', v_orig.id, 'REVERSE',
    jsonb_build_object('reversal_voucher_id', v_rev.id, 'reversal_number', v_rev.voucher_number)
  );

  RETURN v_rev;
END;
$$;

COMMENT ON FUNCTION public.post_voucher(uuid) IS
  'Posts ONLY approved vouchers. Direct draft/submitted post is rejected. Number series updates after validation in one TX.';
