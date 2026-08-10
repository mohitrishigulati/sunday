-- P0 accounting integrity, part 1: posted-document immutability and full audit coverage.
--
-- Vouchers, voucher_lines and ledger_postings were already frozen once posted,
-- but business_documents / business_document_lines / voucher_allocations were
-- not. An invoice's stored totals could therefore be edited after its voucher
-- was posted, silently disagreeing with the ledger it produced.
--
-- Audit triggers covered 13 of 39 tables. Later-phase tables — invoices,
-- allocations, bank statements, closing stock, payroll, and notably user_roles
-- — produced no audit trail at all.

-- ---------------------------------------------------------------------------
-- 1. Posted business documents are immutable
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_document_mutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_document_id uuid;
  v_voucher_id uuid;
  v_status text;
BEGIN
  -- NEW is unassigned on DELETE and OLD on INSERT, so each row image is only
  -- read on the operations where it exists.
  IF TG_TABLE_NAME = 'business_documents' THEN
    IF TG_OP = 'DELETE' THEN
      v_document_id := OLD.id;
      v_voucher_id := OLD.voucher_id;
    ELSE
      v_document_id := NEW.id;
      v_voucher_id := NEW.voucher_id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_document_id := OLD.document_id;
    ELSE
      v_document_id := NEW.document_id;
    END IF;
    SELECT voucher_id INTO v_voucher_id
    FROM public.business_documents WHERE id = v_document_id;
  END IF;

  SELECT status INTO v_status FROM public.vouchers WHERE id = v_voucher_id;

  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION
      'Document % is % and cannot be modified; correct it with a reversal',
      v_document_id, v_status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_documents_immutable ON public.business_documents;
CREATE TRIGGER trg_business_documents_immutable
BEFORE UPDATE OR DELETE ON public.business_documents
FOR EACH ROW EXECUTE FUNCTION public.assert_document_mutable();

DROP TRIGGER IF EXISTS trg_business_document_lines_immutable ON public.business_document_lines;
CREATE TRIGGER trg_business_document_lines_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.business_document_lines
FOR EACH ROW EXECUTE FUNCTION public.assert_document_mutable();

-- Allocations settle posted invoices, so neither UPDATE nor DELETE may touch
-- them: a silent delete would re-open a settled bill with no trace of who
-- un-settled it. Reversal is explicit and additive instead — reverse_bill_
-- allocation() marks the row reversed and leaves both it and its reason in
-- place, so the audit trail keeps the full settlement history.
ALTER TABLE public.voucher_allocations
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES public.profiles (id),
  ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE OR REPLACE FUNCTION public.assert_allocation_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Settlement allocations cannot be deleted; use reverse_bill_allocation()';
  END IF;

  -- The reversal columns are the only permitted change, and only once.
  IF OLD.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Allocation % is already reversed', OLD.id;
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.party_id IS DISTINCT FROM OLD.party_id
     OR NEW.settlement_voucher_line_id IS DISTINCT FROM OLD.settlement_voucher_line_id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.allocation_date IS DISTINCT FROM OLD.allocation_date
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Settlement allocations cannot be edited; reverse and re-allocate';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_allocations_immutable ON public.voucher_allocations;
CREATE TRIGGER trg_voucher_allocations_immutable
BEFORE UPDATE OR DELETE ON public.voucher_allocations
FOR EACH ROW EXECUTE FUNCTION public.assert_allocation_immutable();

CREATE OR REPLACE FUNCTION public.reverse_bill_allocation(
  p_allocation_id uuid,
  p_reason text
)
RETURNS public.voucher_allocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_allocation public.voucher_allocations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reversal reason is required';
  END IF;

  SELECT * INTO v_allocation
  FROM public.voucher_allocations WHERE id = p_allocation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allocation not found';
  END IF;
  IF v_allocation.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Allocation is already reversed';
  END IF;

  PERFORM public.assert_company_capability(v_allocation.company_id, 'write');
  PERFORM public.assert_period_open(v_allocation.company_id, v_allocation.allocation_date);

  UPDATE public.voucher_allocations
  SET reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason)
  WHERE id = p_allocation_id
  RETURNING * INTO v_allocation;

  RETURN v_allocation;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_bill_allocation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_bill_allocation(uuid, text) TO authenticated;

-- A reversed allocation no longer consumes the invoice or the settlement line,
-- so the over-allocation caps added in …027 must skip reversed rows. Without
-- this the bill would stay permanently settled after a reversal. Only the two
-- SUM filters change from the …027 definition.
CREATE OR REPLACE FUNCTION public.validate_voucher_allocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_document public.business_documents%ROWTYPE;
  v_document_status text;
  v_line public.voucher_lines%ROWTYPE;
  v_line_status text;
  v_document_allocated numeric(18,4);
  v_line_allocated numeric(18,4);
  v_line_amount numeric(18,4);
BEGIN
  SELECT d.* INTO v_document
  FROM public.business_documents d
  WHERE d.id = NEW.document_id
  FOR UPDATE;
  SELECT status INTO v_document_status
  FROM public.vouchers WHERE id = v_document.voucher_id;

  IF v_document.id IS NULL OR v_document_status <> 'posted' THEN
    RAISE EXCEPTION 'Only a posted invoice can be settled';
  END IF;

  SELECT vl.* INTO v_line
  FROM public.voucher_lines vl
  WHERE vl.id = NEW.settlement_voucher_line_id
  FOR UPDATE;
  SELECT status INTO v_line_status
  FROM public.vouchers WHERE id = v_line.voucher_id;

  IF v_line.id IS NULL OR v_line_status <> 'posted' THEN
    RAISE EXCEPTION 'Settlement line must belong to a posted voucher';
  END IF;
  IF NEW.company_id <> v_document.company_id OR NEW.company_id <> v_line.company_id
     OR NEW.party_id <> v_document.party_id OR NEW.party_id <> v_line.party_id THEN
    RAISE EXCEPTION 'Settlement company and party must match the invoice and voucher line';
  END IF;
  IF (v_document.document_type = 'sale' AND v_line.credit_amount = 0)
     OR (v_document.document_type = 'purchase' AND v_line.debit_amount = 0) THEN
    RAISE EXCEPTION 'Settlement line has the wrong debit/credit direction';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_document_allocated
  FROM public.voucher_allocations
  WHERE document_id = NEW.document_id
    AND id IS DISTINCT FROM NEW.id
    AND reversed_at IS NULL;
  IF v_document_allocated + NEW.amount > v_document.total_amount THEN
    RAISE EXCEPTION 'Allocation exceeds invoice outstanding amount';
  END IF;

  v_line_amount := GREATEST(v_line.debit_amount, v_line.credit_amount);
  SELECT COALESCE(SUM(amount), 0) INTO v_line_allocated
  FROM public.voucher_allocations
  WHERE settlement_voucher_line_id = NEW.settlement_voucher_line_id
    AND id IS DISTINCT FROM NEW.id
    AND reversed_at IS NULL;
  IF v_line_allocated + NEW.amount > v_line_amount THEN
    RAISE EXCEPTION 'Allocation exceeds the receipt/payment line amount';
  END IF;
  RETURN NEW;
END;
$$;

-- The UNIQUE (settlement_voucher_line_id, document_id) constraint would block
-- re-allocating the same pair after a reversal, so scope it to live rows only.
ALTER TABLE public.voucher_allocations
  DROP CONSTRAINT IF EXISTS voucher_allocations_settlement_voucher_line_id_document_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_allocations_live
  ON public.voucher_allocations (settlement_voucher_line_id, document_id)
  WHERE reversed_at IS NULL;

-- Outstanding per invoice, with reversed allocations excluded. Every consumer —
-- the business page, ageing reports and the allocation RPC — reads this instead
-- of summing allocations itself, so no caller can forget the reversal filter.
-- security_invoker is essential: without it a view runs with its owner's rights
-- on PG15 and would hand every company's outstanding balances to any
-- authenticated user, straight past the RLS on business_documents.
CREATE OR REPLACE VIEW public.business_document_outstanding
WITH (security_invoker = true) AS
SELECT
  d.id AS document_id,
  d.company_id,
  d.party_id,
  d.document_type,
  d.document_number,
  d.document_date,
  d.due_date,
  d.total_amount,
  COALESCE(a.allocated, 0)::numeric(18,4) AS allocated_amount,
  (d.total_amount - COALESCE(a.allocated, 0))::numeric(18,4) AS outstanding_amount
FROM public.business_documents d
LEFT JOIN (
  SELECT document_id, SUM(amount) AS allocated
  FROM public.voucher_allocations
  WHERE reversed_at IS NULL
  GROUP BY document_id
) a ON a.document_id = d.id;

GRANT SELECT ON public.business_document_outstanding TO authenticated;

-- Allocation creation moves into the database so the outstanding check and the
-- insert share one transaction and one exact-decimal computation. The app
-- previously read the sum, subtracted in JavaScript floats, then inserted —
-- two statements a concurrent settlement could interleave with.
CREATE OR REPLACE FUNCTION public.allocate_bill_settlement(
  p_document_id uuid,
  p_settlement_voucher_line_id uuid,
  p_amount numeric,
  p_allocation_date date
)
RETURNS public.voucher_allocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_document public.business_documents%ROWTYPE;
  v_outstanding numeric(18,4);
  v_amount numeric(18,4) := round(p_amount, 4);
  v_allocation public.voucher_allocations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Allocation amount must be greater than zero';
  END IF;

  -- Lock the invoice first so a concurrent allocation cannot pass the same
  -- outstanding check; validate_voucher_allocation() re-checks the caps under
  -- the same lock when the row is inserted.
  SELECT * INTO v_document
  FROM public.business_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  PERFORM public.assert_company_capability(v_document.company_id, 'write');
  PERFORM public.assert_period_open(v_document.company_id, p_allocation_date);

  SELECT outstanding_amount INTO v_outstanding
  FROM public.business_document_outstanding WHERE document_id = p_document_id;

  IF v_amount > v_outstanding THEN
    RAISE EXCEPTION 'Allocation exceeds outstanding %', v_outstanding;
  END IF;

  INSERT INTO public.voucher_allocations (
    company_id, party_id, settlement_voucher_line_id, document_id,
    allocation_date, amount, created_by
  ) VALUES (
    v_document.company_id, v_document.party_id, p_settlement_voucher_line_id,
    p_document_id, p_allocation_date, v_amount, auth.uid()
  )
  RETURNING * INTO v_allocation;

  RETURN v_allocation;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_bill_settlement(uuid, uuid, numeric, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_bill_settlement(uuid, uuid, numeric, date)
  TO authenticated;

REVOKE ALL ON FUNCTION public.assert_document_mutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_allocation_immutable() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Audit rows for child tables must carry the parent's company
-- ---------------------------------------------------------------------------
-- write_audit() read company_id straight off the row. Child tables such as
-- business_document_lines have no company_id of their own, so every audit row
-- they produced stored NULL and dropped out of company-scoped audit reports.
-- Derive it from the parent instead, via whichever foreign key the row carries.
CREATE OR REPLACE FUNCTION public.write_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_record_id uuid;
  v_action text;
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
BEGIN
  v_action := TG_OP;
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_row := v_old;
  ELSE
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
    v_new := to_jsonb(NEW);
    v_row := v_new;
  END IF;

  v_record_id := COALESCE(
    NULLIF(v_row ->> 'id', '')::uuid,
    NULLIF(v_row ->> 'user_id', '')::uuid,
    md5(v_row::text)::uuid
  );

  v_company_id := NULLIF(v_row ->> 'company_id', '')::uuid;

  -- Child rows: walk the one foreign key that reaches a company.
  IF v_company_id IS NULL AND (v_row ? 'document_id') THEN
    SELECT company_id INTO v_company_id
    FROM public.business_documents WHERE id = NULLIF(v_row ->> 'document_id', '')::uuid;
  END IF;
  IF v_company_id IS NULL AND (v_row ? 'voucher_id') THEN
    SELECT company_id INTO v_company_id
    FROM public.vouchers WHERE id = NULLIF(v_row ->> 'voucher_id', '')::uuid;
  END IF;
  IF v_company_id IS NULL AND (v_row ? 'import_id') THEN
    SELECT company_id INTO v_company_id
    FROM public.bank_statement_imports WHERE id = NULLIF(v_row ->> 'import_id', '')::uuid;
  END IF;
  IF v_company_id IS NULL AND (v_row ? 'bank_account_id') THEN
    SELECT company_id INTO v_company_id
    FROM public.bank_accounts WHERE id = NULLIF(v_row ->> 'bank_account_id', '')::uuid;
  END IF;
  IF v_company_id IS NULL AND (v_row ? 'location_id') THEN
    SELECT company_id INTO v_company_id
    FROM public.locations WHERE id = NULLIF(v_row ->> 'location_id', '')::uuid;
  END IF;
  IF v_company_id IS NULL AND (v_row ? 'ledger_id') THEN
    SELECT company_id INTO v_company_id
    FROM public.ledgers WHERE id = NULLIF(v_row ->> 'ledger_id', '')::uuid;
  END IF;

  INSERT INTO public.audit_log
    (actor_id, company_id, table_name, record_id, action, old_row, new_row)
  VALUES
    (auth.uid(), v_company_id, TG_TABLE_NAME, v_record_id, v_action, v_old, v_new);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_audit() FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Audit coverage for every business table
-- ---------------------------------------------------------------------------
-- audit_log itself is excluded (it would recurse) and voucher_number_series is
-- excluded (a hot counter whose every increment would flood the trail; the
-- numbers it issues are already audited on the voucher).
DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'account_groups',
    'attachments',
    'bank_reconciliations',
    'bank_statement_imports',
    'bank_statement_lines',
    'banks',
    'business_document_lines',
    'business_documents',
    'cash_verifications',
    'closing_stock_entries',
    'company_groups',
    'consolidation_ledger_map',
    'cost_centres',
    'expense_heads',
    'financial_year_closures',
    'intercompany_transfers',
    'party_company_links',
    'profiles',
    'roles',
    'salary_register',
    'salesmen',
    'user_roles',
    'voucher_allocations',
    'voucher_types'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
    ) THEN
      PERFORM public.attach_audit_triggers(format('public.%I', t)::regclass);
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.assert_document_mutable() IS
  'Blocks edits to invoices whose voucher is posted or reversed.';
