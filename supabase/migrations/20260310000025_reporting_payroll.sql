ALTER TABLE public.account_groups
  ADD COLUMN IF NOT EXISTS cash_flow_category text
    CHECK (cash_flow_category IN ('operating','investing','financing','cash_equivalent')),
  ADD COLUMN IF NOT EXISTS working_capital_class text
    CHECK (working_capital_class IN ('current_asset','current_liability','non_current'));

CREATE TABLE IF NOT EXISTS public.salary_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  location_id uuid REFERENCES public.locations (id),
  financial_year_id uuid NOT NULL REFERENCES public.financial_years (id),
  employee_party_id uuid NOT NULL REFERENCES public.parties (id),
  salary_month date NOT NULL CHECK (salary_month = date_trunc('month', salary_month)::date),
  basic_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (basic_amount >= 0),
  allowances numeric(18,4) NOT NULL DEFAULT 0 CHECK (allowances >= 0),
  deductions numeric(18,4) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  employer_contribution numeric(18,4) NOT NULL DEFAULT 0 CHECK (employer_contribution >= 0),
  gross_amount numeric(18,4) GENERATED ALWAYS AS (basic_amount + allowances) STORED,
  net_amount numeric(18,4) GENERATED ALWAYS AS (basic_amount + allowances - deductions) STORED,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  payment_voucher_id uuid REFERENCES public.vouchers (id),
  created_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_party_id, salary_month),
  CHECK (basic_amount + allowances >= deductions),
  CHECK ((status = 'paid' AND payment_voucher_id IS NOT NULL) OR status <> 'paid')
);

ALTER TABLE public.salary_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_register FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS salary_register_select ON public.salary_register;
CREATE POLICY salary_register_select ON public.salary_register FOR SELECT TO authenticated
USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));
DROP POLICY IF EXISTS salary_register_write ON public.salary_register;
CREATE POLICY salary_register_write ON public.salary_register FOR ALL TO authenticated
USING (company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']))
WITH CHECK (company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_register TO authenticated;
