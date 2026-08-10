-- Phase 1: audit, immutability, period locks, posting, balance, numbering
CREATE OR REPLACE FUNCTION public.write_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_record_id uuid;
  v_action text;
  v_old jsonb;
  v_new jsonb;
BEGIN
  v_action := TG_OP;
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_record_id := COALESCE(
      NULLIF(v_old ->> 'id', '')::uuid,
      NULLIF(v_old ->> 'user_id', '')::uuid,
      md5(v_old::text)::uuid
    );
    v_company_id := NULLIF(v_old ->> 'company_id', '')::uuid;
  ELSE
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
    v_new := to_jsonb(NEW);
    v_record_id := COALESCE(
      NULLIF(v_new ->> 'id', '')::uuid,
      NULLIF(v_new ->> 'user_id', '')::uuid,
      md5(v_new::text)::uuid
    );
    v_company_id := NULLIF(v_new ->> 'company_id', '')::uuid;
  END IF;

  INSERT INTO public.audit_log (actor_id, company_id, table_name, record_id, action, old_row, new_row)
  VALUES (auth.uid(), v_company_id, TG_TABLE_NAME, v_record_id, v_action, v_old, v_new);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_audit_triggers(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  t text := p_table::text;
  trig text := 'trg_audit_' || replace(t, '.', '_');
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', trig, t);
  EXECUTE format(
    'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %s
     FOR EACH ROW EXECUTE FUNCTION public.write_audit()',
    trig,
    t
  );
END;
$$;

SELECT public.attach_audit_triggers('public.companies');
SELECT public.attach_audit_triggers('public.locations');
SELECT public.attach_audit_triggers('public.bank_accounts');
SELECT public.attach_audit_triggers('public.ledgers');
SELECT public.attach_audit_triggers('public.parties');
SELECT public.attach_audit_triggers('public.party_aliases');
SELECT public.attach_audit_triggers('public.financial_years');
SELECT public.attach_audit_triggers('public.accounting_periods');
SELECT public.attach_audit_triggers('public.vouchers');
SELECT public.attach_audit_triggers('public.voucher_lines');
SELECT public.attach_audit_triggers('public.ledger_postings');
SELECT public.attach_audit_triggers('public.user_company_access');
SELECT public.attach_audit_triggers('public.user_location_access');

CREATE OR REPLACE FUNCTION public.assert_period_open(p_company_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_period public.accounting_periods%ROWTYPE;
  v_fy public.financial_years%ROWTYPE;
BEGIN
  SELECT * INTO v_fy
  FROM public.financial_years
  WHERE company_id = p_company_id
    AND p_date BETWEEN start_date AND end_date
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No financial year covers date % for company %', p_date, p_company_id;
  END IF;

  IF v_fy.is_closed THEN
    RAISE EXCEPTION 'Financial year % is closed', v_fy.code;
  END IF;

  SELECT * INTO v_period
  FROM public.accounting_periods
  WHERE company_id = p_company_id
    AND p_date BETWEEN start_date AND end_date
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No accounting period covers date % for company %', p_date, p_company_id;
  END IF;

  IF v_period.is_locked THEN
    RAISE EXCEPTION 'Accounting period % is locked', v_period.period_no;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_posted_voucher_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'approved', 'reversed') THEN
      RAISE EXCEPTION 'Cannot delete voucher in status %', OLD.status;
    END IF;
    IF EXISTS (SELECT 1 FROM public.ledger_postings WHERE voucher_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot delete voucher with ledger postings';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' THEN
    IF NEW.reversed_by_voucher_id IS DISTINCT FROM OLD.reversed_by_voucher_id
       AND NEW.status = 'reversed'
       AND NEW.voucher_number IS NOT DISTINCT FROM OLD.voucher_number
       AND NEW.company_id = OLD.company_id
       AND NEW.voucher_date = OLD.voucher_date
       AND NEW.voucher_type_id = OLD.voucher_type_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Posted vouchers are immutable';
  END IF;

  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'Reversed vouchers are immutable';
  END IF;

  PERFORM public.assert_period_open(NEW.company_id, NEW.voucher_date);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vouchers_immutability
BEFORE UPDATE OR DELETE ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.prevent_posted_voucher_mutation();

CREATE OR REPLACE FUNCTION public.prevent_voucher_line_mutation_when_posted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_voucher_id uuid;
BEGIN
  v_voucher_id := COALESCE(NEW.voucher_id, OLD.voucher_id);
  SELECT status INTO v_status FROM public.vouchers WHERE id = v_voucher_id;
  IF v_status IN ('posted', 'reversed', 'approved') THEN
    RAISE EXCEPTION 'Cannot modify lines of voucher in status %', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_voucher_lines_posted_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.voucher_lines
FOR EACH ROW EXECUTE FUNCTION public.prevent_voucher_line_mutation_when_posted();

CREATE OR REPLACE FUNCTION public.prevent_ledger_posting_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Ledger postings are immutable';
END;
$$;

CREATE TRIGGER trg_ledger_postings_immutable
BEFORE UPDATE OR DELETE ON public.ledger_postings
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_posting_mutation();

CREATE OR REPLACE FUNCTION public.prevent_bank_statement_raw_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bank statement lines are immutable';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.import_id IS DISTINCT FROM OLD.import_id
      OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
      OR NEW.txn_date IS DISTINCT FROM OLD.txn_date
      OR NEW.value_date IS DISTINCT FROM OLD.value_date
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.reference IS DISTINCT FROM OLD.reference
      OR NEW.debit_amount IS DISTINCT FROM OLD.debit_amount
      OR NEW.credit_amount IS DISTINCT FROM OLD.credit_amount
      OR NEW.balance_after IS DISTINCT FROM OLD.balance_after
      OR NEW.raw_payload IS DISTINCT FROM OLD.raw_payload
      OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint THEN
      RAISE EXCEPTION 'Raw bank statement fields are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bank_statement_lines_immutable
BEFORE UPDATE OR DELETE ON public.bank_statement_lines
FOR EACH ROW EXECUTE FUNCTION public.prevent_bank_statement_raw_mutation();

CREATE OR REPLACE FUNCTION public.assert_voucher_balanced(p_voucher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dr numeric(18, 4);
  v_cr numeric(18, 4);
BEGIN
  SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
  INTO v_dr, v_cr
  FROM public.ledger_postings
  WHERE voucher_id = p_voucher_id;

  IF v_dr <> v_cr THEN
    RAISE EXCEPTION 'Voucher % is out of balance: debit % credit %', p_voucher_id, v_dr, v_cr;
  END IF;

  IF v_dr = 0 THEN
    RAISE EXCEPTION 'Voucher % has no postings', p_voucher_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_assert_voucher_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.assert_voucher_balanced(NEW.voucher_id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_ledger_postings_balanced
AFTER INSERT ON public.ledger_postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.trg_assert_voucher_balanced();

CREATE OR REPLACE FUNCTION public.format_voucher_number(
  p_format text,
  p_company_code text,
  p_location_code text,
  p_type_code text,
  p_fy_code text,
  p_serial bigint
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := p_format;
  v_serial text;
  v_width int;
BEGIN
  v := replace(v, '{COMPANY}', p_company_code);
  v := replace(v, '{LOCATION}', COALESCE(p_location_code, ''));
  v := replace(v, '{TYPE}', p_type_code);
  v := replace(v, '{FY}', p_fy_code);

  IF v ~ '\{SERIAL:[0-9]+\}' THEN
    v_width := substring(v from '\{SERIAL:([0-9]+)\}')::int;
    v_serial := lpad(p_serial::text, v_width, '0');
    v := regexp_replace(v, '\{SERIAL:[0-9]+\}', v_serial);
  ELSE
    v := replace(v, '{SERIAL}', p_serial::text);
  END IF;

  v := regexp_replace(v, '--+', '-', 'g');
  v := regexp_replace(v, '^-|-$', '', 'g');
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.cash_balance(p_location_id uuid, p_as_of date)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(lp.debit_amount - lp.credit_amount), 0)
  FROM public.ledger_postings lp
  JOIN public.ledgers l ON l.id = lp.ledger_id
  WHERE lp.location_id = p_location_id
    AND l.ledger_type = 'cash'
    AND lp.voucher_date <= p_as_of;
$$;

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

  IF v.status NOT IN ('draft', 'submitted', 'approved') THEN
    RAISE EXCEPTION 'Cannot post voucher in status %', v.status;
  END IF;

  PERFORM public.assert_period_open(v.company_id, v.voucher_date);

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
      CASE
        WHEN l.ledger_type = 'cash' THEN vl.debit_amount - vl.credit_amount
        ELSE 0
      END
    ), 0)
    INTO v_dr
    FROM public.voucher_lines vl
    JOIN public.ledgers l ON l.id = vl.ledger_id
    WHERE vl.voucher_id = v.id;

    IF v_cash + v_dr < 0 THEN
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
    SELECT * INTO v_ledger FROM public.ledgers WHERE id = v_line.ledger_id;
    INSERT INTO public.ledger_postings (
      voucher_id,
      voucher_line_id,
      voucher_date,
      company_id,
      location_id,
      financial_year_id,
      ledger_id,
      party_id,
      cost_centre_id,
      salesman_id,
      debit_amount,
      credit_amount,
      voucher_number,
      is_intercompany,
      intercompany_transfer_id
    ) VALUES (
      v.id,
      v_line.id,
      v.voucher_date,
      v_line.company_id,
      v_line.location_id,
      v_line.financial_year_id,
      v_line.ledger_id,
      v_line.party_id,
      v_line.cost_centre_id,
      v_line.salesman_id,
      v_line.debit_amount,
      v_line.credit_amount,
      v_number,
      v_ledger.is_intercompany,
      v.intercompany_transfer_id
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
    auth.uid(),
    v.company_id,
    'vouchers',
    v.id,
    'POST',
    to_jsonb(v),
    jsonb_build_object('voucher_number', v_number)
  );

  RETURN v;
END;
$$;

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

  PERFORM public.assert_period_open(v_orig.company_id, p_reversal_date);

  v_draft := 'DRAFT-' || substr(gen_random_uuid()::text, 1, 8);

  INSERT INTO public.vouchers (
    company_id,
    location_id,
    financial_year_id,
    voucher_type_id,
    voucher_date,
    draft_ref,
    status,
    party_id,
    narration,
    external_ref,
    currency_code,
    created_by,
    reversal_of_voucher_id,
    intercompany_transfer_id,
    cash_transfer_group_id,
    contra_group_id
  ) VALUES (
    v_orig.company_id,
    v_orig.location_id,
    v_orig.financial_year_id,
    v_orig.voucher_type_id,
    p_reversal_date,
    v_draft,
    'draft',
    v_orig.party_id,
    COALESCE(p_narration, 'Reversal of ' || v_orig.voucher_number),
    v_orig.external_ref,
    v_orig.currency_code,
    auth.uid(),
    v_orig.id,
    v_orig.intercompany_transfer_id,
    v_orig.cash_transfer_group_id,
    v_orig.contra_group_id
  )
  RETURNING * INTO v_rev;

  FOR v_line IN
    SELECT * FROM public.voucher_lines WHERE voucher_id = v_orig.id ORDER BY line_no
  LOOP
    INSERT INTO public.voucher_lines (
      voucher_id,
      line_no,
      company_id,
      location_id,
      financial_year_id,
      ledger_id,
      party_id,
      cost_centre_id,
      salesman_id,
      debit_amount,
      credit_amount,
      narration
    ) VALUES (
      v_rev.id,
      v_line.line_no,
      v_line.company_id,
      v_line.location_id,
      v_line.financial_year_id,
      v_line.ledger_id,
      v_line.party_id,
      v_line.cost_centre_id,
      v_line.salesman_id,
      v_line.credit_amount,
      v_line.debit_amount,
      v_line.narration
    );
  END LOOP;

  v_rev := public.post_voucher(v_rev.id);

  UPDATE public.vouchers
  SET status = 'reversed', reversed_by_voucher_id = v_rev.id
  WHERE id = v_orig.id;

  INSERT INTO public.audit_log (actor_id, company_id, table_name, record_id, action, context)
  VALUES (
    auth.uid(),
    v_orig.company_id,
    'vouchers',
    v_orig.id,
    'REVERSE',
    jsonb_build_object('reversal_voucher_id', v_rev.id, 'reversal_number', v_rev.voucher_number)
  );

  RETURN v_rev;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_vouchers_period_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.assert_period_open(NEW.company_id, NEW.voucher_date);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vouchers_period_insert
BEFORE INSERT ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.trg_vouchers_period_on_insert();
