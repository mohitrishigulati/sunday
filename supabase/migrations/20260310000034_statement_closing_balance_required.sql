-- Every new bank statement import must carry its statement closing balance.
-- NOT VALID preserves any historic imports that predate this rule while still
-- enforcing the rule for all new inserts and future updates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bank_statement_imports_closing_balance_required'
      AND conrelid = 'public.bank_statement_imports'::regclass
  ) THEN
    ALTER TABLE public.bank_statement_imports
      ADD CONSTRAINT bank_statement_imports_closing_balance_required
      CHECK (closing_balance IS NOT NULL) NOT VALID;
  END IF;
END
$$;

COMMENT ON CONSTRAINT bank_statement_imports_closing_balance_required
  ON public.bank_statement_imports
  IS 'Closing balance from the uploaded statement is mandatory for reconciliation.';
