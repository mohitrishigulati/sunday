-- Phase 1: locations, banks, financial years, periods
CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  code text NOT NULL,
  name text NOT NULL,
  location_type text NOT NULL CHECK (location_type IN ('branch', 'warehouse', 'cash_counter')),
  parent_location_id uuid REFERENCES public.locations (id),
  is_cash_location boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TRIGGER trg_locations_updated_at
BEFORE UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_locations_company ON public.locations (company_id);

CREATE TABLE public.user_location_access (
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations (id) ON DELETE CASCADE,
  can_read boolean NOT NULL DEFAULT true,
  can_write boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);

CREATE INDEX idx_user_location_access_location ON public.user_location_access (location_id);

CREATE TABLE public.banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.financial_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  code text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  CHECK (start_date < end_date)
);

CREATE TRIGGER trg_financial_years_updated_at
BEFORE UPDATE ON public.financial_years
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_financial_years_company ON public.financial_years (company_id);

CREATE TABLE public.accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year_id uuid NOT NULL REFERENCES public.financial_years (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies (id),
  period_no smallint NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_locked boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  locked_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (financial_year_id, period_no),
  CHECK (start_date <= end_date)
);

CREATE INDEX idx_accounting_periods_company_dates
  ON public.accounting_periods (company_id, start_date, end_date);
