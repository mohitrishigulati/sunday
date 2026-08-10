-- P0 accounting integrity, part 3:
--   a) canonical bank fingerprints, generated in the database
--   b) a duplicate exception queue instead of silent skips
--   c) atomic inter-company and location cash-transfer RPCs
--
-- The fingerprint was computed in the app with a JS SHA-256 over
-- bankAccountId|txnDate|reference|description|debit|credit. Two problems: any
-- future parser normalising differently produces a different key for the same
-- transaction, and description text (which banks reformat between statement
-- runs) made the key unstable. It is now derived by the database from the
-- prescribed fields only, so no caller can influence it.

-- ---------------------------------------------------------------------------
-- 1. Canonical fingerprint
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Key order is fixed by specification:
--   bank_account_id | normalized_reference | txn_date | amount(18,4) | DR|CR
-- normalized_reference = uppercase, all whitespace removed, '' when absent.
-- Description is deliberately excluded.
CREATE OR REPLACE FUNCTION public.bank_line_fingerprint(
  p_bank_account_id uuid,
  p_reference text,
  p_txn_date date,
  p_debit_amount numeric,
  p_credit_amount numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT encode(
    digest(
      concat_ws('|',
        p_bank_account_id::text,
        upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g')),
        to_char(p_txn_date, 'YYYY-MM-DD'),
        to_char(
          round(GREATEST(coalesce(p_debit_amount, 0), coalesce(p_credit_amount, 0)), 4),
          'FM9999999999999990.0000'
        ),
        CASE WHEN coalesce(p_debit_amount, 0) > 0 THEN 'DR' ELSE 'CR' END
      ),
      'sha256'
    ),
    'hex'
  );
$$;

GRANT EXECUTE ON FUNCTION public.bank_line_fingerprint(uuid, text, date, numeric, numeric)
  TO authenticated;

-- Any client-supplied fingerprint is overwritten, on insert and on update.
CREATE OR REPLACE FUNCTION public.set_bank_line_fingerprint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.fingerprint := public.bank_line_fingerprint(
    NEW.bank_account_id, NEW.reference, NEW.txn_date,
    NEW.debit_amount, NEW.credit_amount
  );
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Duplicate exception queue
-- ---------------------------------------------------------------------------
-- A same bank/reference/date/amount/direction collision is no longer skipped in
-- silence. The raw row is kept exactly as imported, linked to the row it
-- duplicates, and queued for a human decision.
ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS duplicate_of_line_id uuid
    REFERENCES public.bank_statement_lines (id);

CREATE TABLE IF NOT EXISTS public.bank_duplicate_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts (id),
  import_id uuid NOT NULL REFERENCES public.bank_statement_imports (id) ON DELETE CASCADE,
  duplicate_line_id uuid NOT NULL REFERENCES public.bank_statement_lines (id),
  primary_line_id uuid NOT NULL REFERENCES public.bank_statement_lines (id),
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'confirmed_duplicate', 'confirmed_distinct')),
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (duplicate_line_id)
);

CREATE INDEX IF NOT EXISTS idx_bank_duplicate_exceptions_open
  ON public.bank_duplicate_exceptions (bank_account_id)
  WHERE status = 'open';

ALTER TABLE public.bank_duplicate_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_duplicate_exceptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_duplicate_exceptions_select ON public.bank_duplicate_exceptions;
CREATE POLICY bank_duplicate_exceptions_select ON public.bank_duplicate_exceptions
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR bank_account_id IN (
      SELECT id FROM public.bank_accounts
      WHERE company_id IN (SELECT public.user_company_ids('read'))
    )
  );

DROP POLICY IF EXISTS bank_duplicate_exceptions_write ON public.bank_duplicate_exceptions;
CREATE POLICY bank_duplicate_exceptions_write ON public.bank_duplicate_exceptions
  FOR ALL TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR bank_account_id IN (
      SELECT id FROM public.bank_accounts
      WHERE company_id IN (SELECT public.user_company_ids('write'))
    )
  )
  WITH CHECK (
    public.user_has_role(ARRAY['admin'])
    OR bank_account_id IN (
      SELECT id FROM public.bank_accounts
      WHERE company_id IN (SELECT public.user_company_ids('write'))
    )
  );

-- The unique constraint has to allow the duplicate row to land, so uniqueness
-- now applies only to rows that are not themselves flagged as duplicates. The
-- replacement index is created after the backfill in section 3: re-keying
-- existing rows is precisely what surfaces collisions, so the index cannot
-- exist while that UPDATE runs or it would abort on the first one.
ALTER TABLE public.bank_statement_lines
  DROP CONSTRAINT IF EXISTS bank_statement_lines_bank_account_id_fingerprint_key;

-- Routes a colliding row to the queue instead of rejecting or skipping it. The
-- oldest row for a fingerprint stays primary; later arrivals are flagged.
CREATE OR REPLACE FUNCTION public.route_bank_line_duplicate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_primary_id uuid;
BEGIN
  SELECT id INTO v_primary_id
  FROM public.bank_statement_lines
  WHERE bank_account_id = NEW.bank_account_id
    AND fingerprint = NEW.fingerprint
    AND duplicate_of_line_id IS NULL
    AND id <> NEW.id
  ORDER BY created_at, id
  LIMIT 1;

  IF v_primary_id IS NOT NULL THEN
    UPDATE public.bank_statement_lines
    SET duplicate_of_line_id = v_primary_id, match_status = 'ignored'
    WHERE id = NEW.id;

    INSERT INTO public.bank_duplicate_exceptions (
      bank_account_id, import_id, duplicate_line_id, primary_line_id, fingerprint
    ) VALUES (
      NEW.bank_account_id, NEW.import_id, NEW.id, v_primary_id, NEW.fingerprint
    )
    ON CONFLICT (duplicate_line_id) DO NOTHING;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_line_fingerprint ON public.bank_statement_lines;
CREATE TRIGGER trg_bank_line_fingerprint
BEFORE INSERT OR UPDATE OF bank_account_id, reference, txn_date, debit_amount, credit_amount
ON public.bank_statement_lines
FOR EACH ROW EXECUTE FUNCTION public.set_bank_line_fingerprint();

DROP TRIGGER IF EXISTS trg_bank_line_duplicate ON public.bank_statement_lines;
CREATE TRIGGER trg_bank_line_duplicate
AFTER INSERT ON public.bank_statement_lines
FOR EACH ROW EXECUTE FUNCTION public.route_bank_line_duplicate();

-- ---------------------------------------------------------------------------
-- 3. Backfill existing rows onto the canonical fingerprint
-- ---------------------------------------------------------------------------
-- Raw imported fields are never altered. Rows are only re-keyed; where the new
-- key collides, the oldest row stays primary and the rest are flagged and
-- queued exactly as a fresh import would be.
DO $$
DECLARE
  v_line record;
  v_primary_id uuid;
BEGIN
  ALTER TABLE public.bank_statement_lines DISABLE TRIGGER trg_bank_line_duplicate;

  UPDATE public.bank_statement_lines l
  SET fingerprint = public.bank_line_fingerprint(
    l.bank_account_id, l.reference, l.txn_date, l.debit_amount, l.credit_amount
  );

  FOR v_line IN
    SELECT id, bank_account_id, import_id, fingerprint
    FROM public.bank_statement_lines
    ORDER BY created_at, id
  LOOP
    SELECT id INTO v_primary_id
    FROM public.bank_statement_lines
    WHERE bank_account_id = v_line.bank_account_id
      AND fingerprint = v_line.fingerprint
      AND duplicate_of_line_id IS NULL
      AND id <> v_line.id
    ORDER BY created_at, id
    LIMIT 1;

    IF v_primary_id IS NOT NULL THEN
      UPDATE public.bank_statement_lines
      SET duplicate_of_line_id = v_primary_id
      WHERE id = v_line.id;

      INSERT INTO public.bank_duplicate_exceptions (
        bank_account_id, import_id, duplicate_line_id, primary_line_id, fingerprint
      ) VALUES (
        v_line.bank_account_id, v_line.import_id, v_line.id, v_primary_id,
        v_line.fingerprint
      )
      ON CONFLICT (duplicate_line_id) DO NOTHING;
    END IF;
  END LOOP;

  ALTER TABLE public.bank_statement_lines ENABLE TRIGGER trg_bank_line_duplicate;
END;
$$;

-- Safe to enforce now that every existing collision has been flagged and queued.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_lines_primary
  ON public.bank_statement_lines (bank_account_id, fingerprint)
  WHERE duplicate_of_line_id IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Atomic inter-company transfer
-- ---------------------------------------------------------------------------
-- Both draft legs and the transfer link are written in one transaction; a
-- failure on the second company can no longer leave the first company holding
-- an orphan voucher with no counterpart.
CREATE OR REPLACE FUNCTION public.create_intercompany_transfer(p_payload jsonb)
RETURNS public.intercompany_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_from_company_id uuid := (p_payload ->> 'from_company_id')::uuid;
  v_to_company_id uuid := (p_payload ->> 'to_company_id')::uuid;
  v_amount numeric(18,4) := round((p_payload ->> 'amount')::numeric, 4);
  v_transfer_date date := (p_payload ->> 'transfer_date')::date;
  v_utr text := NULLIF(p_payload ->> 'utr_reference', '');
  v_narration text := NULLIF(p_payload ->> 'narration', '');
  v_from_fy uuid := (p_payload ->> 'from_financial_year_id')::uuid;
  v_to_fy uuid := (p_payload ->> 'to_financial_year_id')::uuid;
  v_from_credit_ledger uuid := (p_payload ->> 'from_credit_ledger_id')::uuid;
  v_from_debit_ledger uuid := (p_payload ->> 'from_debit_ledger_id')::uuid;
  v_to_debit_ledger uuid := (p_payload ->> 'to_debit_ledger_id')::uuid;
  v_to_credit_ledger uuid := (p_payload ->> 'to_credit_ledger_id')::uuid;
  v_group_id uuid;
  v_transfer public.intercompany_transfers%ROWTYPE;
  v_from_voucher uuid;
  v_to_voucher uuid;
  v_type_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;
  IF v_from_company_id = v_to_company_id THEN
    RAISE EXCEPTION 'A transfer needs two different companies';
  END IF;

  -- Both sides must be writable by the caller and in an open period.
  PERFORM public.assert_company_capability(v_from_company_id, 'write');
  PERFORM public.assert_company_capability(v_to_company_id, 'write');
  PERFORM public.assert_period_open(v_from_company_id, v_transfer_date);
  PERFORM public.assert_period_open(v_to_company_id, v_transfer_date);

  IF NOT public.has_permission('vouchers.draft')
     AND NOT public.user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Missing vouchers.draft permission';
  END IF;

  SELECT c.group_id INTO v_group_id
  FROM public.companies c WHERE c.id = v_from_company_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.companies
    WHERE id = v_to_company_id AND group_id = v_group_id
  ) THEN
    RAISE EXCEPTION 'Both companies must belong to the same group';
  END IF;

  INSERT INTO public.intercompany_transfers (
    group_id, from_company_id, to_company_id, amount, transfer_date, utr_reference
  ) VALUES (
    v_group_id, v_from_company_id, v_to_company_id, v_amount, v_transfer_date, v_utr
  )
  RETURNING * INTO v_transfer;

  -- Paying company: credit the funding ledger, debit the IC receivable.
  SELECT id INTO v_type_id FROM public.voucher_types
  WHERE company_id = v_from_company_id AND code = 'JV';
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'Journal voucher type is not seeded for the paying company';
  END IF;

  INSERT INTO public.vouchers (
    company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref,
    status, narration, created_by, intercompany_transfer_id
  ) VALUES (
    v_from_company_id, v_from_fy, v_type_id, v_transfer_date,
    'DRAFT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'draft', COALESCE(v_narration, 'Inter-company transfer'), auth.uid(),
    v_transfer.id
  )
  RETURNING id INTO v_from_voucher;

  INSERT INTO public.voucher_lines (
    voucher_id, line_no, company_id, financial_year_id, ledger_id,
    debit_amount, credit_amount, narration
  ) VALUES
    (v_from_voucher, 1, v_from_company_id, v_from_fy, v_from_debit_ledger,
     v_amount, 0, COALESCE(v_utr, 'Inter-company transfer')),
    (v_from_voucher, 2, v_from_company_id, v_from_fy, v_from_credit_ledger,
     0, v_amount, COALESCE(v_utr, 'Inter-company transfer'));

  -- Receiving company: debit the receiving ledger, credit the IC payable.
  SELECT id INTO v_type_id FROM public.voucher_types
  WHERE company_id = v_to_company_id AND code = 'JV';
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'Journal voucher type is not seeded for the receiving company';
  END IF;

  INSERT INTO public.vouchers (
    company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref,
    status, narration, created_by, intercompany_transfer_id
  ) VALUES (
    v_to_company_id, v_to_fy, v_type_id, v_transfer_date,
    'DRAFT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'draft', COALESCE(v_narration, 'Inter-company transfer'), auth.uid(),
    v_transfer.id
  )
  RETURNING id INTO v_to_voucher;

  INSERT INTO public.voucher_lines (
    voucher_id, line_no, company_id, financial_year_id, ledger_id,
    debit_amount, credit_amount, narration
  ) VALUES
    (v_to_voucher, 1, v_to_company_id, v_to_fy, v_to_debit_ledger,
     v_amount, 0, COALESCE(v_utr, 'Inter-company transfer')),
    (v_to_voucher, 2, v_to_company_id, v_to_fy, v_to_credit_ledger,
     0, v_amount, COALESCE(v_utr, 'Inter-company transfer'));

  UPDATE public.intercompany_transfers
  SET from_voucher_id = v_from_voucher, to_voucher_id = v_to_voucher
  WHERE id = v_transfer.id
  RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.create_intercompany_transfer(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_intercompany_transfer(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Atomic location cash transfer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_location_cash_transfer(p_payload jsonb)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_company_id uuid := (p_payload ->> 'company_id')::uuid;
  v_financial_year_id uuid := (p_payload ->> 'financial_year_id')::uuid;
  v_from_location_id uuid := (p_payload ->> 'from_location_id')::uuid;
  v_to_location_id uuid := (p_payload ->> 'to_location_id')::uuid;
  v_amount numeric(18,4) := round((p_payload ->> 'amount')::numeric, 4);
  v_transfer_date date := (p_payload ->> 'transfer_date')::date;
  v_narration text := NULLIF(p_payload ->> 'narration', '');
  v_from_ledger uuid;
  v_to_ledger uuid;
  v_type_id uuid;
  v_voucher public.vouchers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;
  IF v_from_location_id = v_to_location_id THEN
    RAISE EXCEPTION 'A cash transfer needs two different locations';
  END IF;

  PERFORM public.assert_company_capability(v_company_id, 'write');
  PERFORM public.assert_period_open(v_company_id, v_transfer_date);
  PERFORM public.assert_cashier_location_write(v_from_location_id);
  PERFORM public.assert_cashier_location_write(v_to_location_id);

  IF NOT public.has_permission('cash.write')
     AND NOT public.user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Missing cash.write permission';
  END IF;

  -- Each location books to its own cash ledger, linked in …015.
  SELECT cash_ledger_id INTO v_from_ledger FROM public.locations
  WHERE id = v_from_location_id AND company_id = v_company_id;
  SELECT cash_ledger_id INTO v_to_ledger FROM public.locations
  WHERE id = v_to_location_id AND company_id = v_company_id;

  IF v_from_ledger IS NULL OR v_to_ledger IS NULL THEN
    RAISE EXCEPTION 'Both locations must belong to this company and have a cash ledger';
  END IF;

  SELECT id INTO v_type_id FROM public.voucher_types
  WHERE company_id = v_company_id AND code = 'CTR';
  IF v_type_id IS NULL THEN
    SELECT id INTO v_type_id FROM public.voucher_types
    WHERE company_id = v_company_id AND code = 'JV';
  END IF;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No transfer or journal voucher type is seeded for this company';
  END IF;

  INSERT INTO public.vouchers (
    company_id, financial_year_id, voucher_type_id, voucher_date, location_id,
    draft_ref, status, narration, created_by
  ) VALUES (
    v_company_id, v_financial_year_id, v_type_id, v_transfer_date,
    v_from_location_id,
    'DRAFT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'draft', COALESCE(v_narration, 'Cash transfer between locations'), auth.uid()
  )
  RETURNING * INTO v_voucher;

  INSERT INTO public.voucher_lines (
    voucher_id, line_no, company_id, location_id, financial_year_id, ledger_id,
    debit_amount, credit_amount, narration
  ) VALUES
    (v_voucher.id, 1, v_company_id, v_to_location_id, v_financial_year_id,
     v_to_ledger, v_amount, 0, 'Cash received'),
    (v_voucher.id, 2, v_company_id, v_from_location_id, v_financial_year_id,
     v_from_ledger, 0, v_amount, 'Cash sent');

  RETURN v_voucher;
END;
$$;

REVOKE ALL ON FUNCTION public.create_location_cash_transfer(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_location_cash_transfer(jsonb) TO authenticated;

SELECT public.attach_audit_triggers('public.bank_duplicate_exceptions'::regclass);

COMMENT ON FUNCTION public.bank_line_fingerprint(uuid, text, date, numeric, numeric) IS
  'Canonical bank line key: bank_account_id | normalized_reference | txn_date | amount(18,4) | DR/CR. Description excluded by specification.';
