-- Classify a canonical collision before the partial unique index checks it.
-- The previous AFTER INSERT trigger ran too late to retain every raw row.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    extensions.digest(
      concat_ws('|',
        p_bank_account_id::text,
        upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g')),
        to_char(p_txn_date, 'YYYY-MM-DD'),
        to_char(round(GREATEST(coalesce(p_debit_amount, 0), coalesce(p_credit_amount, 0)), 4), 'FM9999999999999990.0000'),
        CASE WHEN coalesce(p_debit_amount, 0) > 0 THEN 'DR' ELSE 'CR' END
      ),
      'sha256'
    ),
    'hex'
  );
$$;

GRANT EXECUTE ON FUNCTION public.bank_line_fingerprint(uuid, text, date, numeric, numeric) TO authenticated;

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
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed_duplicate', 'confirmed_distinct')),
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (duplicate_line_id)
);

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

ALTER TABLE public.bank_statement_lines
  DROP CONSTRAINT IF EXISTS bank_statement_lines_bank_account_id_fingerprint_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_lines_primary
  ON public.bank_statement_lines (bank_account_id, fingerprint)
  WHERE duplicate_of_line_id IS NULL;

CREATE OR REPLACE FUNCTION public.classify_bank_line_duplicate()
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
  ORDER BY created_at, id
  LIMIT 1;

  IF v_primary_id IS NOT NULL THEN
    NEW.duplicate_of_line_id := v_primary_id;
    NEW.match_status := 'ignored';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_bank_line_duplicate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.duplicate_of_line_id IS NOT NULL THEN
    INSERT INTO public.bank_duplicate_exceptions (
      bank_account_id, import_id, duplicate_line_id, primary_line_id, fingerprint
    ) VALUES (
      NEW.bank_account_id, NEW.import_id, NEW.id,
      NEW.duplicate_of_line_id, NEW.fingerprint
    )
    ON CONFLICT (duplicate_line_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_line_fingerprint ON public.bank_statement_lines;
DROP TRIGGER IF EXISTS trg_bank_line_duplicate ON public.bank_statement_lines;
DROP TRIGGER IF EXISTS trg_10_bank_line_fingerprint ON public.bank_statement_lines;
DROP TRIGGER IF EXISTS trg_20_bank_line_classify_duplicate ON public.bank_statement_lines;
DROP TRIGGER IF EXISTS trg_30_bank_line_queue_duplicate ON public.bank_statement_lines;

CREATE TRIGGER trg_10_bank_line_fingerprint
BEFORE INSERT OR UPDATE OF bank_account_id, reference, txn_date, debit_amount, credit_amount
ON public.bank_statement_lines
FOR EACH ROW EXECUTE FUNCTION public.set_bank_line_fingerprint();

CREATE TRIGGER trg_20_bank_line_classify_duplicate
BEFORE INSERT ON public.bank_statement_lines
FOR EACH ROW EXECUTE FUNCTION public.classify_bank_line_duplicate();

CREATE TRIGGER trg_30_bank_line_queue_duplicate
AFTER INSERT ON public.bank_statement_lines
FOR EACH ROW EXECUTE FUNCTION public.queue_bank_line_duplicate();
