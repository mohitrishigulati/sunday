-- Phase 1 review hardening (pre-approval)
-- Addresses: SECURITY DEFINER authz, posted-line indirect mutation,
-- RLS join isolation, cashier on approve/post, OB offset ledger, JWT test helpers.

-- ---------------------------------------------------------------------------
-- Auth helpers usable inside SECURITY DEFINER (must not trust RLS alone)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_company_capability(
  p_company_id uuid,
  p_capability text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.user_has_role(ARRAY['admin']) THEN
    RETURN;
  END IF;

  IF p_company_id IS NULL OR p_company_id NOT IN (
    SELECT public.user_company_ids(p_capability)
  ) THEN
    RAISE EXCEPTION 'Missing % access for company %', p_capability, p_company_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_cashier_location_write(p_location_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_restricted_cashier() THEN
    RETURN;
  END IF;

  IF p_location_id IS NULL OR p_location_id NOT IN (
    SELECT public.user_location_ids('write')
  ) THEN
    RAISE EXCEPTION 'Cashier cannot act on location %', p_location_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Opening-balance offset ledger (system) so TB always has a balancing leg
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
-- approve_voucher: period lock + company approve + cashier location
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
-- post_voucher: reaffirm single-TX numbering + explicit authz (RLS bypassed)
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

  -- Entire body runs in the caller's single transaction.
  -- Any RAISE after series UPDATE rolls back the counter increment (no gaps).
  SELECT * INTO v FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found';
  END IF;

  IF v.status = 'posted' THEN
    RETURN v;
  END IF;

  IF v.status NOT IN ('draft', 'submitted', 'approved') THEN
    RAISE EXCEPTION 'Cannot post voucher in status %', v.status;
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

  -- Validate BEFORE touching the number series (failed posts must not consume numbers)
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

-- ---------------------------------------------------------------------------
-- Block indirect mutation of posted data
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_reopen_posted_voucher()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Disallow moving out of posted/reversed except the controlled reverse link path
  IF OLD.status IN ('posted', 'reversed') AND NEW.status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot reopen voucher from status %', OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vouchers_no_reopen ON public.vouchers;
CREATE TRIGGER trg_vouchers_no_reopen
BEFORE UPDATE ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.prevent_reopen_posted_voucher();

CREATE OR REPLACE FUNCTION public.prevent_line_company_hijack()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_status text;
BEGIN
  SELECT company_id, status INTO v_company, v_status
  FROM public.vouchers WHERE id = NEW.voucher_id;

  IF v_status IN ('posted', 'reversed', 'approved') THEN
    RAISE EXCEPTION 'Cannot modify lines of voucher in status %', v_status;
  END IF;

  IF NEW.company_id <> v_company THEN
    RAISE EXCEPTION 'voucher_lines.company_id must match voucher company';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ledgers l
    WHERE l.id = NEW.ledger_id AND l.company_id = NEW.company_id AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Ledger does not belong to line company';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_lines_company_guard ON public.voucher_lines;
CREATE TRIGGER trg_voucher_lines_company_guard
BEFORE INSERT OR UPDATE ON public.voucher_lines
FOR EACH ROW EXECUTE FUNCTION public.prevent_line_company_hijack();

-- ---------------------------------------------------------------------------
-- RLS: close join-path leaks for attachments / bank / audit / postings
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS attachments_select ON public.attachments;
CREATE POLICY attachments_select ON public.attachments
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR company_id IN (SELECT public.user_company_ids('read'))
  );

DROP POLICY IF EXISTS bank_accounts_select ON public.bank_accounts;
CREATE POLICY bank_accounts_select ON public.bank_accounts
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR company_id IN (SELECT public.user_company_ids('read'))
  );

DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR (
      company_id IS NOT NULL
      AND company_id IN (SELECT public.user_company_ids('read'))
      AND (
        public.user_has_role(ARRAY['management'])
        OR public.has_permission('reports.company')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Restrict SECURITY DEFINER execute surface
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.post_voucher(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_voucher(uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_voucher(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_opening_balance_offset_ledger(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_company_capability(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_cashier_location_write(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.post_voucher(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_voucher(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_voucher(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_opening_balance_offset_ledger(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trial_balance(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_trial_balance_tied(uuid, date) TO authenticated;

-- anon must not call mutating RPCs
REVOKE EXECUTE ON FUNCTION public.post_voucher(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reverse_voucher(uuid, date, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_voucher(uuid) FROM anon;

-- Audit remains non-writable for clients
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM anon;
GRANT SELECT ON public.audit_log TO authenticated;

-- ---------------------------------------------------------------------------
-- JWT session helper for acceptance checks 6–7
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.test_as_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.test_as_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_as_user(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.test_as_user(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.test_as_user(uuid) TO authenticated;

COMMENT ON FUNCTION public.post_voucher(uuid) IS
  'Single-transaction post: validates period/balance/authz BEFORE series lock+increment; any failure rolls back counter (no gaps). SECURITY DEFINER with search_path=public and explicit capability checks because RLS is off.';
