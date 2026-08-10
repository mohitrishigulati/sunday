-- Preserve the source statement's exact physical row order. This is separate
-- from transaction date because a statement can contain many same-day rows.
ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS statement_sequence integer;

-- Existing batch inserts retain their physical tuple order, which is the best
-- available reconstruction for imports created before this column existed.
WITH sequenced AS (
  SELECT id,
         row_number() OVER (PARTITION BY import_id ORDER BY ctid)::integer AS sequence_no
  FROM public.bank_statement_lines
)
UPDATE public.bank_statement_lines line
SET statement_sequence = sequenced.sequence_no
FROM sequenced
WHERE line.id = sequenced.id
  AND line.statement_sequence IS NULL;

ALTER TABLE public.bank_statement_lines
  ALTER COLUMN statement_sequence SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bank_statement_lines_sequence_positive'
      AND conrelid = 'public.bank_statement_lines'::regclass
  ) THEN
    ALTER TABLE public.bank_statement_lines
      ADD CONSTRAINT bank_statement_lines_sequence_positive
      CHECK (statement_sequence > 0);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_lines_import_sequence
  ON public.bank_statement_lines (import_id, statement_sequence);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_statement_order
  ON public.bank_statement_lines (import_id, statement_sequence);

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
      OR NEW.statement_sequence IS DISTINCT FROM OLD.statement_sequence
      OR NEW.txn_date IS DISTINCT FROM OLD.txn_date
      OR NEW.value_date IS DISTINCT FROM OLD.value_date
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.reference IS DISTINCT FROM OLD.reference
      OR NEW.transaction_type IS DISTINCT FROM OLD.transaction_type
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

COMMENT ON COLUMN public.bank_statement_lines.statement_sequence IS
  'One-based physical row order in the uploaded statement; immutable after import.';
