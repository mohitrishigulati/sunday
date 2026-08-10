-- The prescribed fingerprint deliberately excludes narration. When reference
-- is blank, legitimate same-day/same-amount rows collide. A different running
-- balance proves that the row is distinct, so keep it in the unmatched flow.

CREATE OR REPLACE FUNCTION public.classify_bank_line_duplicate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_primary_id uuid;
  v_primary_balance numeric;
BEGIN
  SELECT id, balance_after INTO v_primary_id, v_primary_balance
  FROM public.bank_statement_lines
  WHERE bank_account_id = NEW.bank_account_id
    AND fingerprint = NEW.fingerprint
    AND duplicate_of_line_id IS NULL
  ORDER BY created_at, id
  LIMIT 1;

  IF v_primary_id IS NOT NULL THEN
    NEW.duplicate_of_line_id := v_primary_id;
    IF NEW.balance_after IS NOT NULL
       AND v_primary_balance IS NOT NULL
       AND NEW.balance_after <> v_primary_balance THEN
      NEW.match_status := 'unmatched';
    ELSE
      NEW.match_status := 'ignored';
    END IF;
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
      bank_account_id, import_id, duplicate_line_id, primary_line_id,
      fingerprint, status, resolution_note, resolved_at
    ) VALUES (
      NEW.bank_account_id, NEW.import_id, NEW.id, NEW.duplicate_of_line_id,
      NEW.fingerprint,
      CASE WHEN NEW.match_status = 'unmatched' THEN 'confirmed_distinct' ELSE 'open' END,
      CASE WHEN NEW.match_status = 'unmatched' THEN 'Automatically confirmed distinct: running balances differ.' ELSE NULL END,
      CASE WHEN NEW.match_status = 'unmatched' THEN now() ELSE NULL END
    )
    ON CONFLICT (duplicate_line_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

UPDATE public.bank_statement_lines duplicate_line
SET match_status = 'unmatched'
FROM public.bank_statement_lines primary_line
WHERE duplicate_line.duplicate_of_line_id = primary_line.id
  AND duplicate_line.balance_after IS NOT NULL
  AND primary_line.balance_after IS NOT NULL
  AND duplicate_line.balance_after <> primary_line.balance_after
  AND duplicate_line.match_status = 'ignored';

UPDATE public.bank_duplicate_exceptions exception_row
SET status = 'confirmed_distinct',
    resolution_note = 'Automatically confirmed distinct: running balances differ.',
    resolved_at = now()
FROM public.bank_statement_lines duplicate_line
JOIN public.bank_statement_lines primary_line
  ON primary_line.id = duplicate_line.duplicate_of_line_id
WHERE exception_row.duplicate_line_id = duplicate_line.id
  AND duplicate_line.balance_after IS NOT NULL
  AND primary_line.balance_after IS NOT NULL
  AND duplicate_line.balance_after <> primary_line.balance_after
  AND exception_row.status = 'open';
