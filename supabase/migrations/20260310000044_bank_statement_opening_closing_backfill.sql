-- Backfill exact statement opening/calculated closing for imports created
-- before source-row sequencing and per-row balance validation were introduced.
WITH statement_bounds AS (
  SELECT
    l.import_id,
    (array_agg(
      (l.balance_after - l.credit_amount + l.debit_amount)::numeric(18,4)
      ORDER BY l.statement_sequence
    ))[1] AS derived_opening,
    (array_agg(l.balance_after ORDER BY l.statement_sequence DESC))[1] AS derived_closing,
    bool_and(l.balance_after IS NOT NULL) AS has_every_balance
  FROM public.bank_statement_lines l
  GROUP BY l.import_id
)
UPDATE public.bank_statement_imports i
SET opening_balance = COALESCE(i.opening_balance, b.derived_opening),
    calculated_closing = b.derived_closing,
    balance_mismatch = i.closing_balance IS DISTINCT FROM b.derived_closing
FROM statement_bounds b
WHERE b.import_id = i.id
  AND b.has_every_balance;

COMMENT ON COLUMN public.bank_statement_imports.calculated_closing IS
  'Closing balance recalculated from the immutable statement row sequence; compared with the manually entered statement closing.';
