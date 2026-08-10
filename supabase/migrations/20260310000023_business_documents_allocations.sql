-- Phase 4: sales/purchase documents, line taxes and bill-wise settlement.
ALTER TABLE public.parties
  ADD COLUMN IF NOT EXISTS credit_days integer NOT NULL DEFAULT 0 CHECK (credit_days BETWEEN 0 AND 3650);

CREATE TABLE IF NOT EXISTS public.business_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL UNIQUE REFERENCES public.vouchers (id),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  financial_year_id uuid NOT NULL REFERENCES public.financial_years (id),
  party_id uuid NOT NULL REFERENCES public.parties (id),
  document_type text NOT NULL CHECK (document_type IN ('sale', 'purchase')),
  document_number text NOT NULL,
  document_date date NOT NULL,
  due_date date NOT NULL,
  place_of_supply char(2),
  is_interstate boolean NOT NULL DEFAULT false,
  subtotal numeric(18,4) NOT NULL CHECK (subtotal >= 0),
  discount_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  taxable_amount numeric(18,4) NOT NULL CHECK (taxable_amount >= 0),
  cgst_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0),
  sgst_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0),
  igst_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (igst_amount >= 0),
  cess_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (cess_amount >= 0),
  tds_section text,
  tds_rate numeric(8,4) NOT NULL DEFAULT 0 CHECK (tds_rate BETWEEN 0 AND 100),
  tds_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  round_off numeric(18,4) NOT NULL DEFAULT 0,
  total_amount numeric(18,4) NOT NULL CHECK (total_amount > 0),
  eway_bill_no text,
  created_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, document_type, document_number)
);

CREATE TABLE IF NOT EXISTS public.business_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.business_documents (id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no > 0),
  description text NOT NULL,
  hsn_sac text,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'NOS',
  rate numeric(18,4) NOT NULL CHECK (rate >= 0),
  discount_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  taxable_amount numeric(18,4) NOT NULL CHECK (taxable_amount >= 0),
  gst_rate numeric(8,4) NOT NULL DEFAULT 0 CHECK (gst_rate BETWEEN 0 AND 100),
  cgst_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0),
  sgst_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0),
  igst_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (igst_amount >= 0),
  cess_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (cess_amount >= 0),
  trade_ledger_id uuid NOT NULL REFERENCES public.ledgers (id),
  cost_centre_id uuid REFERENCES public.cost_centres (id),
  salesman_id uuid REFERENCES public.salesmen (id),
  UNIQUE (document_id, line_no)
);

CREATE TABLE IF NOT EXISTS public.voucher_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  party_id uuid NOT NULL REFERENCES public.parties (id),
  settlement_voucher_line_id uuid NOT NULL REFERENCES public.voucher_lines (id),
  document_id uuid NOT NULL REFERENCES public.business_documents (id),
  allocation_date date NOT NULL,
  amount numeric(18,4) NOT NULL CHECK (amount > 0),
  created_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (settlement_voucher_line_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_business_documents_party_due
  ON public.business_documents (company_id, party_id, due_date);
CREATE INDEX IF NOT EXISTS idx_voucher_allocations_document
  ON public.voucher_allocations (document_id);

DROP TRIGGER IF EXISTS trg_business_documents_updated_at ON public.business_documents;
CREATE TRIGGER trg_business_documents_updated_at
BEFORE UPDATE ON public.business_documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.business_document_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_allocations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_documents_select ON public.business_documents;
CREATE POLICY business_documents_select ON public.business_documents FOR SELECT TO authenticated
USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));
DROP POLICY IF EXISTS business_documents_write ON public.business_documents;
CREATE POLICY business_documents_write ON public.business_documents FOR ALL TO authenticated
USING (company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']))
WITH CHECK (company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']));

DROP POLICY IF EXISTS business_document_lines_select ON public.business_document_lines;
CREATE POLICY business_document_lines_select ON public.business_document_lines FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.business_documents d WHERE d.id = document_id));
DROP POLICY IF EXISTS business_document_lines_write ON public.business_document_lines;
CREATE POLICY business_document_lines_write ON public.business_document_lines FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.business_documents d WHERE d.id = document_id AND (d.company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']))))
WITH CHECK (EXISTS (SELECT 1 FROM public.business_documents d WHERE d.id = document_id AND (d.company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']))));

DROP POLICY IF EXISTS voucher_allocations_select ON public.voucher_allocations;
CREATE POLICY voucher_allocations_select ON public.voucher_allocations FOR SELECT TO authenticated
USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));
DROP POLICY IF EXISTS voucher_allocations_write ON public.voucher_allocations;
CREATE POLICY voucher_allocations_write ON public.voucher_allocations FOR ALL TO authenticated
USING (company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']))
WITH CHECK (company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_documents, public.business_document_lines, public.voucher_allocations TO authenticated;
