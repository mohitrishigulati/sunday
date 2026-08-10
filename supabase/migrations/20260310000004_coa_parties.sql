-- Phase 1: chart of accounts, parties, dimensions
CREATE TABLE public.account_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies (id),
  parent_id uuid REFERENCES public.account_groups (id),
  code text NOT NULL,
  name text NOT NULL,
  nature text NOT NULL CHECK (nature IN ('asset', 'liability', 'equity', 'income', 'expense')),
  bs_pl_section text,
  is_intercompany boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE public.parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.company_groups (id),
  code text NOT NULL,
  name text NOT NULL,
  party_kinds text[] NOT NULL DEFAULT '{}',
  gstin text,
  pan text,
  state_code char(2),
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, code)
);

CREATE TRIGGER trg_parties_updated_at
BEFORE UPDATE ON public.parties
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_parties_group ON public.parties (group_id);
CREATE INDEX idx_parties_name_trgm ON public.parties USING gin (name gin_trgm_ops);

CREATE TABLE public.party_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties (id) ON DELETE CASCADE,
  alias_text text NOT NULL,
  normalized_alias text NOT NULL,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'bank_import', 'invoice')),
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, normalized_alias)
);

CREATE INDEX idx_party_aliases_normalized ON public.party_aliases (normalized_alias);
CREATE INDEX idx_party_aliases_normalized_trgm
  ON public.party_aliases USING gin (normalized_alias gin_trgm_ops);

CREATE TABLE public.salesmen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.company_groups (id),
  party_id uuid REFERENCES public.parties (id),
  code text NOT NULL,
  name text NOT NULL,
  role_type text NOT NULL CHECK (role_type IN ('salesman', 'broker')),
  default_commission_pct numeric(8, 4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, code)
);

CREATE TABLE public.cost_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE public.ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  account_group_id uuid REFERENCES public.account_groups (id),
  code text NOT NULL,
  name text NOT NULL,
  ledger_type text NOT NULL CHECK (
    ledger_type IN (
      'general',
      'cash',
      'bank',
      'party',
      'intercompany_receivable',
      'intercompany_payable',
      'intercompany_income',
      'intercompany_expense'
    )
  ),
  party_id uuid REFERENCES public.parties (id),
  counterpart_company_id uuid REFERENCES public.companies (id),
  is_intercompany boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  CHECK (
    (
      ledger_type IN (
        'intercompany_receivable',
        'intercompany_payable',
        'intercompany_income',
        'intercompany_expense'
      )
      AND is_intercompany = true
      AND counterpart_company_id IS NOT NULL
    )
    OR (
      ledger_type NOT IN (
        'intercompany_receivable',
        'intercompany_payable',
        'intercompany_income',
        'intercompany_expense'
      )
    )
  )
);

CREATE TRIGGER trg_ledgers_updated_at
BEFORE UPDATE ON public.ledgers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_ledgers_company ON public.ledgers (company_id);
CREATE INDEX idx_ledgers_party ON public.ledgers (party_id);
CREATE INDEX idx_ledgers_intercompany ON public.ledgers (company_id) WHERE is_intercompany;

CREATE TABLE public.party_company_links (
  party_id uuid NOT NULL REFERENCES public.parties (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES public.ledgers (id),
  credit_limit numeric(18, 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, company_id),
  UNIQUE (ledger_id)
);

CREATE TABLE public.expense_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  ledger_id uuid NOT NULL REFERENCES public.ledgers (id),
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  bank_id uuid REFERENCES public.banks (id),
  ledger_id uuid NOT NULL REFERENCES public.ledgers (id),
  account_name text NOT NULL,
  account_number text NOT NULL,
  ifsc text,
  account_type text CHECK (account_type IN ('current', 'savings', 'od', 'cc')),
  currency_code char(3) NOT NULL DEFAULT 'INR',
  statement_parser_key text,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, account_number),
  UNIQUE (ledger_id)
);

CREATE TRIGGER trg_bank_accounts_updated_at
BEFORE UPDATE ON public.bank_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_bank_accounts_company ON public.bank_accounts (company_id);

CREATE TABLE public.closing_stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  financial_year_id uuid NOT NULL REFERENCES public.financial_years (id),
  period_id uuid REFERENCES public.accounting_periods (id),
  as_of_date date NOT NULL,
  amount numeric(18, 4) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  approved_by uuid REFERENCES public.profiles (id),
  approved_at timestamptz,
  narration text,
  created_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_closing_stock_approved
  ON public.closing_stock_entries (
    company_id,
    financial_year_id,
    (COALESCE(period_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  WHERE status = 'approved';

CREATE TRIGGER trg_closing_stock_updated_at
BEFORE UPDATE ON public.closing_stock_entries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_hash text,
  uploaded_by uuid REFERENCES public.profiles (id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.consolidation_ledger_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.company_groups (id),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  ledger_id uuid NOT NULL REFERENCES public.ledgers (id),
  consol_account_code text NOT NULL,
  elim_category text NOT NULL DEFAULT 'none'
    CHECK (
      elim_category IN (
        'none',
        'ic_receivable',
        'ic_payable',
        'ic_income',
        'ic_expense',
        'ic_transfer'
      )
    ),
  UNIQUE (ledger_id)
);
