ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS counterparty_bank_account_id uuid
  REFERENCES public.bank_accounts (id);

COMMENT ON COLUMN public.bank_statement_lines.counterparty_bank_account_id IS
  'Selected destination/source bank account for own-company contra or group inter-company transfer classification.';

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_counterparty_bank
  ON public.bank_statement_lines (counterparty_bank_account_id)
  WHERE counterparty_bank_account_id IS NOT NULL;
