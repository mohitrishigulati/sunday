-- Acceptance hardening for the 9 control checks
-- 1 draft unbalanced OK / post fails
-- 2-3 gapless numbering under concurrency and failed posts
-- 4 locked period rejects create/approve/post
-- 5 posted immutable
-- 6-7 company + cashier location RLS
-- 8 trial balance ties
-- 9 audit trigger-only; client cannot forge

CREATE OR REPLACE FUNCTION public.is_restricted_cashier()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_has_role(ARRAY['cashier'])
    AND NOT public.user_has_role(ARRAY['admin', 'accountant', 'approver', 'management', 'data_entry']);
$$;

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

  -- Locked period: approve must reject
  PERFORM public.assert_period_open(v.company_id, v.voucher_date);

  UPDATE public.vouchers
  SET
    status = 'approved',
    approved_by = auth.uid()
  WHERE id = v.id
  RETURNING * INTO v;

  INSERT INTO public.audit_log (actor_id, company_id, table_name, record_id, action, new_row)
  VALUES (auth.uid(), v.company_id, 'vouchers', v.id, 'APPROVE', to_jsonb(v));

  RETURN v;
END;
$$;

-- Trial balance primitive: must always tie (Σ debit = Σ credit) for a company/date
CREATE OR REPLACE FUNCTION public.trial_balance(
  p_company_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  ledger_id uuid,
  ledger_code text,
  ledger_name text,
  debit_total numeric(18, 4),
  credit_total numeric(18, 4),
  balance numeric(18, 4)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    l.id,
    l.code,
    l.name,
    COALESCE(SUM(lp.debit_amount), 0)::numeric(18, 4) AS debit_total,
    COALESCE(SUM(lp.credit_amount), 0)::numeric(18, 4) AS credit_total,
    (COALESCE(SUM(lp.debit_amount), 0) - COALESCE(SUM(lp.credit_amount), 0))::numeric(18, 4) AS balance
  FROM public.ledgers l
  LEFT JOIN public.ledger_postings lp
    ON lp.ledger_id = l.id
   AND lp.company_id = p_company_id
   AND lp.voucher_date <= p_as_of
  WHERE l.company_id = p_company_id
    AND l.deleted_at IS NULL
  GROUP BY l.id, l.code, l.name
  HAVING COALESCE(SUM(lp.debit_amount), 0) <> 0
      OR COALESCE(SUM(lp.credit_amount), 0) <> 0
  ORDER BY l.code;
$$;

CREATE OR REPLACE FUNCTION public.assert_trial_balance_tied(
  p_company_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_dr numeric(18, 4);
  v_cr numeric(18, 4);
BEGIN
  SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
  INTO v_dr, v_cr
  FROM public.ledger_postings
  WHERE company_id = p_company_id
    AND voucher_date <= p_as_of;

  IF v_dr <> v_cr THEN
    RAISE EXCEPTION 'Trial balance does not tie for company % as of %: Dr % Cr %',
      p_company_id, p_as_of, v_dr, v_cr;
  END IF;

  RETURN true;
END;
$$;

-- Tighten voucher RLS for restricted cashiers
DROP POLICY IF EXISTS vouchers_select ON public.vouchers;
DROP POLICY IF EXISTS vouchers_insert ON public.vouchers;
DROP POLICY IF EXISTS vouchers_update ON public.vouchers;
DROP POLICY IF EXISTS vouchers_delete ON public.vouchers;
DROP POLICY IF EXISTS voucher_lines_select ON public.voucher_lines;
DROP POLICY IF EXISTS voucher_lines_write ON public.voucher_lines;
DROP POLICY IF EXISTS ledger_postings_select ON public.ledger_postings;
DROP POLICY IF EXISTS locations_select ON public.locations;
DROP POLICY IF EXISTS cash_verifications_select ON public.cash_verifications;
DROP POLICY IF EXISTS cash_verifications_write ON public.cash_verifications;

CREATE POLICY locations_select ON public.locations
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR (
      company_id IN (SELECT public.user_company_ids('read'))
      AND (
        NOT public.is_restricted_cashier()
        OR id IN (SELECT public.user_location_ids('read'))
      )
    )
  );

CREATE POLICY vouchers_select ON public.vouchers
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR (
      company_id IN (SELECT public.user_company_ids('read'))
      AND (
        NOT public.is_restricted_cashier()
        OR (
          location_id IS NOT NULL
          AND location_id IN (SELECT public.user_location_ids('read'))
        )
      )
    )
  );

CREATE POLICY vouchers_insert ON public.vouchers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('vouchers.draft')
    AND company_id IN (SELECT public.user_company_ids('write'))
    AND (
      NOT public.is_restricted_cashier()
      OR (
        location_id IS NOT NULL
        AND location_id IN (SELECT public.user_location_ids('write'))
      )
    )
  );

CREATE POLICY vouchers_update ON public.vouchers
  FOR UPDATE TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids('write'))
    AND status IN ('draft', 'submitted', 'rejected')
    AND (
      NOT public.is_restricted_cashier()
      OR (
        location_id IS NOT NULL
        AND location_id IN (SELECT public.user_location_ids('write'))
      )
    )
  )
  WITH CHECK (
    company_id IN (SELECT public.user_company_ids('write'))
    AND (
      NOT public.is_restricted_cashier()
      OR (
        location_id IS NOT NULL
        AND location_id IN (SELECT public.user_location_ids('write'))
      )
    )
  );

CREATE POLICY vouchers_delete ON public.vouchers
  FOR DELETE TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids('write'))
    AND status IN ('draft', 'rejected')
    AND (
      NOT public.is_restricted_cashier()
      OR (
        location_id IS NOT NULL
        AND location_id IN (SELECT public.user_location_ids('write'))
      )
    )
  );

CREATE POLICY voucher_lines_select ON public.voucher_lines
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR (
      company_id IN (SELECT public.user_company_ids('read'))
      AND (
        NOT public.is_restricted_cashier()
        OR (
          location_id IS NOT NULL
          AND location_id IN (SELECT public.user_location_ids('read'))
        )
        OR EXISTS (
          SELECT 1 FROM public.vouchers v
          WHERE v.id = voucher_id
            AND v.location_id IN (SELECT public.user_location_ids('read'))
        )
      )
    )
  );

CREATE POLICY voucher_lines_write ON public.voucher_lines
  FOR ALL TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids('write'))
    AND EXISTS (
      SELECT 1 FROM public.vouchers v
      WHERE v.id = voucher_id AND v.status IN ('draft', 'submitted', 'rejected')
    )
    AND (
      NOT public.is_restricted_cashier()
      OR (
        COALESCE(location_id, (
          SELECT v.location_id FROM public.vouchers v WHERE v.id = voucher_id
        )) IN (SELECT public.user_location_ids('write'))
      )
    )
  )
  WITH CHECK (
    company_id IN (SELECT public.user_company_ids('write'))
    AND (
      NOT public.is_restricted_cashier()
      OR (
        COALESCE(location_id, (
          SELECT v.location_id FROM public.vouchers v WHERE v.id = voucher_id
        )) IN (SELECT public.user_location_ids('write'))
      )
    )
  );

CREATE POLICY ledger_postings_select ON public.ledger_postings
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin', 'management'])
    OR (
      company_id IN (SELECT public.user_company_ids('read'))
      AND (
        NOT public.is_restricted_cashier()
        OR (
          location_id IS NOT NULL
          AND location_id IN (SELECT public.user_location_ids('read'))
        )
      )
    )
  );

CREATE POLICY cash_verifications_select ON public.cash_verifications
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR (
      company_id IN (SELECT public.user_company_ids('read'))
      AND location_id IN (SELECT public.user_location_ids('read'))
    )
    OR (
      company_id IN (SELECT public.user_company_ids('read'))
      AND NOT public.is_restricted_cashier()
    )
  );

CREATE POLICY cash_verifications_write ON public.cash_verifications
  FOR ALL TO authenticated
  USING (
    location_id IN (SELECT public.user_location_ids('write'))
    OR (
      company_id IN (SELECT public.user_company_ids('write'))
      AND NOT public.is_restricted_cashier()
    )
  )
  WITH CHECK (
    location_id IN (SELECT public.user_location_ids('write'))
    OR (
      company_id IN (SELECT public.user_company_ids('write'))
      AND NOT public.is_restricted_cashier()
    )
  );

-- Audit: clients may SELECT (via policy) but never INSERT/UPDATE/DELETE
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM anon;
REVOKE ALL ON public.audit_log FROM PUBLIC;

GRANT SELECT ON public.audit_log TO authenticated;

-- Defense in depth: explicit deny write policies (no WITH CHECK true)
DROP POLICY IF EXISTS audit_log_client_insert ON public.audit_log;
DROP POLICY IF EXISTS audit_log_client_update ON public.audit_log;
DROP POLICY IF EXISTS audit_log_client_delete ON public.audit_log;

-- Keep select policy from prior migration; ensure no write policies exist for clients.
-- Triggers/functions remain SECURITY DEFINER and bypass RLS + use table owner rights.

GRANT EXECUTE ON FUNCTION public.approve_voucher(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trial_balance(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_trial_balance_tied(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_restricted_cashier() TO authenticated;

-- Document numbering invariant: counter advances only inside post_voucher after
-- period + balance validation, and only commits with the voucher. Failed posts
-- roll back the series row lock update → no gaps (check 3).
COMMENT ON FUNCTION public.post_voucher(uuid) IS
  'Allocates gapless voucher number under row lock only after period/balance checks; single transaction so failed posts leave no gaps.';
