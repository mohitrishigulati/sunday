-- Operational integrity hardening for bill settlement, bank matching and attachments.

CREATE UNIQUE INDEX IF NOT EXISTS uq_attachments_storage_path
  ON public.attachments (storage_path);

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
  WHERE document_id = NEW.document_id AND id IS DISTINCT FROM NEW.id;
  IF v_document_allocated + NEW.amount > v_document.total_amount THEN
    RAISE EXCEPTION 'Allocation exceeds invoice outstanding amount';
  END IF;

  v_line_amount := GREATEST(v_line.debit_amount, v_line.credit_amount);
  SELECT COALESCE(SUM(amount), 0) INTO v_line_allocated
  FROM public.voucher_allocations
  WHERE settlement_voucher_line_id = NEW.settlement_voucher_line_id
    AND id IS DISTINCT FROM NEW.id;
  IF v_line_allocated + NEW.amount > v_line_amount THEN
    RAISE EXCEPTION 'Allocation exceeds the receipt/payment line amount';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_voucher_allocation ON public.voucher_allocations;
CREATE TRIGGER trg_validate_voucher_allocation
BEFORE INSERT OR UPDATE ON public.voucher_allocations
FOR EACH ROW EXECUTE FUNCTION public.validate_voucher_allocation();

CREATE OR REPLACE FUNCTION public.suggest_bank_statement_parties(p_import_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET row_security = off
AS $$
DECLARE
  v_company_id uuid;
  v_group_id uuid;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT i.company_id, c.group_id INTO v_company_id, v_group_id
  FROM public.bank_statement_imports i
  JOIN public.companies c ON c.id = i.company_id
  WHERE i.id = p_import_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Statement import not found'; END IF;
  PERFORM public.assert_company_capability(v_company_id, 'write');

  WITH candidates AS (
    SELECT l.id AS line_id, a.party_id,
      row_number() OVER (
        PARTITION BY l.id
        ORDER BY
          CASE WHEN lower(COALESCE(l.description, '') || ' ' || COALESCE(l.reference, ''))
                    LIKE '%' || a.normalized_alias || '%' THEN 1 ELSE 0 END DESC,
          similarity(lower(COALESCE(l.description, '') || ' ' || COALESCE(l.reference, '')), a.normalized_alias) DESC,
          length(a.normalized_alias) DESC
      ) AS rank_no,
      GREATEST(
        CASE WHEN lower(COALESCE(l.description, '') || ' ' || COALESCE(l.reference, ''))
                  LIKE '%' || a.normalized_alias || '%' THEN 1 ELSE 0 END,
        similarity(lower(COALESCE(l.description, '') || ' ' || COALESCE(l.reference, '')), a.normalized_alias)
      ) AS score
    FROM public.bank_statement_lines l
    JOIN public.party_aliases a ON a.confirmed
    JOIN public.parties p ON p.id = a.party_id AND p.group_id = v_group_id
    WHERE l.import_id = p_import_id AND l.match_status = 'unmatched'
  )
  UPDATE public.bank_statement_lines l
  SET suggested_party_id = c.party_id,
      ambiguity_note = CASE WHEN c.score < 1 THEN 'Fuzzy alias suggestion' ELSE NULL END
  FROM candidates c
  WHERE c.line_id = l.id AND c.rank_no = 1 AND c.score >= 0.35;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_bank_statement_line(
  p_line_id uuid,
  p_voucher_id uuid DEFAULT NULL,
  p_ignore boolean DEFAULT false
)
RETURNS public.bank_statement_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_line public.bank_statement_lines%ROWTYPE;
  v_company_id uuid;
  v_bank_ledger_id uuid;
  v_voucher public.vouchers%ROWTYPE;
  v_party_id uuid;
  v_expected_amount numeric(18,4);
  v_matching_amount numeric(18,4);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_permission('bank.import') AND NOT public.user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Missing bank.import permission';
  END IF;
  SELECT l.* INTO v_line
  FROM public.bank_statement_lines l
  WHERE l.id = p_line_id
  FOR UPDATE;
  SELECT company_id, ledger_id INTO v_company_id, v_bank_ledger_id
  FROM public.bank_accounts WHERE id = v_line.bank_account_id;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'Bank statement line not found'; END IF;
  PERFORM public.assert_company_capability(v_company_id, 'write');

  IF p_ignore THEN
    UPDATE public.bank_statement_lines
      SET match_status = 'ignored', matched_voucher_id = NULL
      WHERE id = p_line_id RETURNING * INTO v_line;
    RETURN v_line;
  END IF;
  IF p_voucher_id IS NULL THEN RAISE EXCEPTION 'Voucher is required'; END IF;

  SELECT * INTO v_voucher FROM public.vouchers
  WHERE id = p_voucher_id AND company_id = v_company_id AND status = 'posted';
  IF v_voucher.id IS NULL THEN RAISE EXCEPTION 'Voucher must be posted in the same company'; END IF;
  IF abs(v_voucher.voucher_date - v_line.txn_date) > 7 THEN
    RAISE EXCEPTION 'Voucher date must be within 7 days of the bank transaction';
  END IF;

  v_expected_amount := GREATEST(v_line.debit_amount, v_line.credit_amount);
  SELECT COALESCE(SUM(
    CASE WHEN v_line.debit_amount > 0 THEN vl.credit_amount ELSE vl.debit_amount END
  ), 0), MAX(vl.party_id)
    INTO v_matching_amount, v_party_id
  FROM public.voucher_lines vl
  WHERE vl.voucher_id = p_voucher_id AND vl.ledger_id = v_bank_ledger_id;
  IF v_matching_amount <> v_expected_amount THEN
    RAISE EXCEPTION 'Voucher bank leg does not match this account, direction and amount';
  END IF;

  IF v_party_id IS NULL THEN
    SELECT party_id INTO v_party_id FROM public.vouchers WHERE id = p_voucher_id;
  END IF;
  UPDATE public.bank_statement_lines
    SET match_status = 'matched', matched_voucher_id = p_voucher_id,
        suggested_party_id = COALESCE(v_party_id, suggested_party_id), ambiguity_note = NULL
    WHERE id = p_line_id RETURNING * INTO v_line;
  RETURN v_line;
END;
$$;

REVOKE ALL ON FUNCTION public.suggest_bank_statement_parties(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.match_bank_statement_line(uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_bank_statement_parties(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_bank_statement_line(uuid,uuid,boolean) TO authenticated;

-- Security-definer functions must remain pinned to explicit search paths.
ALTER FUNCTION public.suggest_bank_statement_parties(uuid) SET search_path = public, extensions;
ALTER FUNCTION public.match_bank_statement_line(uuid,uuid,boolean) SET search_path = public;

CREATE OR REPLACE FUNCTION public.validate_closing_stock_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_year public.financial_years%ROWTYPE;
BEGIN
  SELECT * INTO v_year FROM public.financial_years WHERE id = NEW.financial_year_id;
  IF v_year.id IS NULL OR v_year.company_id <> NEW.company_id OR NEW.as_of_date NOT BETWEEN v_year.start_date AND v_year.end_date THEN
    RAISE EXCEPTION 'Closing stock company, financial year and date do not match';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    RAISE EXCEPTION 'Approved closing stock is immutable; create a replacement draft';
  END IF;
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    IF NOT public.has_permission('vouchers.approve') AND NOT public.user_has_role(ARRAY['admin']) THEN
      RAISE EXCEPTION 'Missing voucher approval permission';
    END IF;
    PERFORM public.assert_company_capability(NEW.company_id, 'approve');
    IF NEW.created_by = auth.uid() AND NOT public.user_has_role(ARRAY['admin']) THEN
      RAISE EXCEPTION 'Maker cannot approve own closing stock';
    END IF;
    NEW.approved_by := auth.uid(); NEW.approved_at := now();
  ELSE
    NEW.approved_by := NULL; NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_closing_stock_entry ON public.closing_stock_entries;
CREATE TRIGGER trg_validate_closing_stock_entry
BEFORE INSERT OR UPDATE ON public.closing_stock_entries
FOR EACH ROW EXECUTE FUNCTION public.validate_closing_stock_entry();

CREATE OR REPLACE FUNCTION public.prevent_approved_closing_stock_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN IF OLD.status = 'approved' THEN RAISE EXCEPTION 'Approved closing stock cannot be deleted'; END IF; RETURN OLD; END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_approved_closing_stock_delete ON public.closing_stock_entries;
CREATE TRIGGER trg_prevent_approved_closing_stock_delete BEFORE DELETE ON public.closing_stock_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_approved_closing_stock_delete();
