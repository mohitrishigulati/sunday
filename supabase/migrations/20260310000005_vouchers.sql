-- Phase 1: voucher types, vouchers, lines, postings, numbering, IC, cash verify, bank import stubs
CREATE TABLE public.voucher_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies (id),
  code text NOT NULL,
  name text NOT NULL,
  number_format text NOT NULL,
  requires_location boolean NOT NULL DEFAULT false,
  affects_cash boolean NOT NULL DEFAULT false,
  affects_bank boolean NOT NULL DEFAULT false,
  allow_negative_cash boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE public.voucher_number_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  location_id uuid REFERENCES public.locations (id),
  voucher_type_id uuid NOT NULL REFERENCES public.voucher_types (id),
  financial_year_id uuid NOT NULL REFERENCES public.financial_years (id),
  last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  UNIQUE NULLS NOT DISTINCT (company_id, location_id, voucher_type_id, financial_year_id)
);

CREATE TABLE public.intercompany_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.company_groups (id),
  from_company_id uuid NOT NULL REFERENCES public.companies (id),
  to_company_id uuid NOT NULL REFERENCES public.companies (id),
  amount numeric(18, 4) NOT NULL CHECK (amount > 0),
  transfer_date date NOT NULL,
  utr_reference text,
  from_voucher_id uuid,
  to_voucher_id uuid,
  match_status text NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('pending', 'matched', 'partial', 'unmatched')),
  matched_at timestamptz,
  matched_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_company_id <> to_company_id)
);

CREATE TABLE public.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  location_id uuid REFERENCES public.locations (id),
  financial_year_id uuid NOT NULL REFERENCES public.financial_years (id),
  voucher_type_id uuid NOT NULL REFERENCES public.voucher_types (id),
  voucher_date date NOT NULL,
  draft_ref text NOT NULL,
  voucher_number text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'submitted',
        'approved',
        'posted',
        'rejected',
        'reversed',
        'cancelled'
      )
    ),
  party_id uuid REFERENCES public.parties (id),
  narration text,
  external_ref text,
  currency_code char(3) NOT NULL DEFAULT 'INR',
  created_by uuid REFERENCES public.profiles (id),
  submitted_by uuid REFERENCES public.profiles (id),
  approved_by uuid REFERENCES public.profiles (id),
  posted_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  reversal_of_voucher_id uuid REFERENCES public.vouchers (id),
  reversed_by_voucher_id uuid REFERENCES public.vouchers (id),
  intercompany_transfer_id uuid REFERENCES public.intercompany_transfers (id),
  cash_transfer_group_id uuid,
  contra_group_id uuid,
  attachment_id uuid REFERENCES public.attachments (id),
  gst_invoice_no text,
  gst_invoice_date date,
  place_of_supply char(2),
  is_interstate boolean,
  eway_bill_no text,
  UNIQUE (company_id, draft_ref)
);

CREATE UNIQUE INDEX uq_vouchers_number
  ON public.vouchers (company_id, voucher_number)
  WHERE voucher_number IS NOT NULL;

CREATE INDEX idx_vouchers_company_status_date
  ON public.vouchers (company_id, status, voucher_date);
CREATE INDEX idx_vouchers_ic ON public.vouchers (intercompany_transfer_id)
  WHERE intercompany_transfer_id IS NOT NULL;

CREATE TRIGGER trg_vouchers_updated_at
BEFORE UPDATE ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.intercompany_transfers
  ADD CONSTRAINT fk_ict_from_voucher
  FOREIGN KEY (from_voucher_id) REFERENCES public.vouchers (id);

ALTER TABLE public.intercompany_transfers
  ADD CONSTRAINT fk_ict_to_voucher
  FOREIGN KEY (to_voucher_id) REFERENCES public.vouchers (id);

CREATE TABLE public.voucher_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.vouchers (id) ON DELETE CASCADE,
  line_no int NOT NULL CHECK (line_no > 0),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  location_id uuid REFERENCES public.locations (id),
  financial_year_id uuid NOT NULL REFERENCES public.financial_years (id),
  ledger_id uuid NOT NULL REFERENCES public.ledgers (id),
  party_id uuid REFERENCES public.parties (id),
  cost_centre_id uuid REFERENCES public.cost_centres (id),
  salesman_id uuid REFERENCES public.salesmen (id),
  debit_amount numeric(18, 4) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(18, 4) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  narration text,
  hsn_sac text,
  taxable_amount numeric(18, 4),
  cgst_amount numeric(18, 4),
  sgst_amount numeric(18, 4),
  igst_amount numeric(18, 4),
  cess_amount numeric(18, 4),
  UNIQUE (voucher_id, line_no),
  CHECK (
    (debit_amount > 0 AND credit_amount = 0)
    OR (credit_amount > 0 AND debit_amount = 0)
  )
);

CREATE INDEX idx_voucher_lines_voucher ON public.voucher_lines (voucher_id);
CREATE INDEX idx_voucher_lines_ledger ON public.voucher_lines (ledger_id);

CREATE TABLE public.ledger_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.vouchers (id),
  voucher_line_id uuid NOT NULL REFERENCES public.voucher_lines (id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  voucher_date date NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies (id),
  location_id uuid REFERENCES public.locations (id),
  financial_year_id uuid NOT NULL REFERENCES public.financial_years (id),
  ledger_id uuid NOT NULL REFERENCES public.ledgers (id),
  party_id uuid REFERENCES public.parties (id),
  cost_centre_id uuid REFERENCES public.cost_centres (id),
  salesman_id uuid REFERENCES public.salesmen (id),
  debit_amount numeric(18, 4) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(18, 4) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  voucher_number text NOT NULL,
  is_intercompany boolean NOT NULL DEFAULT false,
  intercompany_transfer_id uuid REFERENCES public.intercompany_transfers (id),
  CHECK (
    (debit_amount > 0 AND credit_amount = 0)
    OR (credit_amount > 0 AND debit_amount = 0)
  )
);

CREATE INDEX idx_ledger_postings_company_date
  ON public.ledger_postings (company_id, voucher_date);
CREATE INDEX idx_ledger_postings_ledger_date
  ON public.ledger_postings (ledger_id, voucher_date);
CREATE INDEX idx_ledger_postings_party
  ON public.ledger_postings (party_id, company_id, voucher_date);
CREATE INDEX idx_ledger_postings_location
  ON public.ledger_postings (location_id, voucher_date)
  WHERE location_id IS NOT NULL;
CREATE INDEX idx_ledger_postings_voucher ON public.ledger_postings (voucher_id);
CREATE INDEX idx_ledger_postings_ic
  ON public.ledger_postings (intercompany_transfer_id)
  WHERE intercompany_transfer_id IS NOT NULL;

CREATE TABLE public.cash_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  location_id uuid NOT NULL REFERENCES public.locations (id),
  verification_date date NOT NULL,
  system_cash_balance numeric(18, 4) NOT NULL,
  physical_cash_balance numeric(18, 4) NOT NULL,
  difference numeric(18, 4) GENERATED ALWAYS AS (physical_cash_balance - system_cash_balance) STORED,
  verified_by uuid REFERENCES public.profiles (id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, verification_date)
);

-- Bank import tables (Phase 3 UI; schema ready)
CREATE TABLE public.bank_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts (id),
  source_format text NOT NULL CHECK (source_format IN ('xlsx', 'csv', 'pdf')),
  parser_key text,
  file_hash text NOT NULL,
  file_name text,
  statement_from date,
  statement_to date,
  opening_balance numeric(18, 4),
  closing_balance numeric(18, 4),
  calculated_closing numeric(18, 4),
  balance_mismatch boolean NOT NULL DEFAULT false,
  imported_by uuid REFERENCES public.profiles (id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, file_hash)
);

CREATE TABLE public.bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.bank_statement_imports (id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts (id),
  txn_date date NOT NULL,
  value_date date,
  description text,
  reference text,
  debit_amount numeric(18, 4) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(18, 4) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  balance_after numeric(18, 4),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint text NOT NULL,
  match_status text NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'matched', 'ambiguous', 'ignored')),
  matched_voucher_id uuid REFERENCES public.vouchers (id),
  suggested_party_id uuid REFERENCES public.parties (id),
  ambiguity_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, fingerprint),
  CHECK (
    (debit_amount > 0 AND credit_amount = 0)
    OR (credit_amount > 0 AND debit_amount = 0)
  )
);

CREATE INDEX idx_bank_statement_lines_account_date
  ON public.bank_statement_lines (bank_account_id, txn_date);

CREATE TABLE public.bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts (id),
  as_of_date date NOT NULL,
  statement_closing numeric(18, 4) NOT NULL,
  book_closing numeric(18, 4) NOT NULL,
  difference numeric(18, 4) GENERATED ALWAYS AS (statement_closing - book_closing) STORED,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  created_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_log (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  company_id uuid,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL,
  old_row jsonb,
  new_row jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_audit_log_company_time ON public.audit_log (company_id, occurred_at DESC);
CREATE INDEX idx_audit_log_record ON public.audit_log (table_name, record_id);
