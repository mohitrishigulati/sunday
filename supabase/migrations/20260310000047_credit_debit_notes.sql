-- Credit Notes and Debit Notes (Tally Ctrl+F8 / Ctrl+F9, Busy equivalents).
--
-- These are statutory, not conveniences: without a credit note there is no way
-- to record a sales return, a rate difference or a post-invoice discount, and
-- GSTR-1's credit/debit note tables cannot be filed at all. They need no
-- inventory, so they sit cleanly on the existing business_documents shape.
--
-- A credit note mirrors a sale: the original debited the party and credited
-- sales plus output tax, so the note credits the party and debits sales return
-- plus tax. A debit note mirrors a purchase the same way. Each note points at
-- the invoice it adjusts, which GST reporting requires and which lets the note
-- be settled against that invoice through the normal allocation path.

-- ---------------------------------------------------------------------------
-- 1. Document types
-- ---------------------------------------------------------------------------
ALTER TABLE public.business_documents
  DROP CONSTRAINT IF EXISTS business_documents_document_type_check;
ALTER TABLE public.business_documents
  ADD CONSTRAINT business_documents_document_type_check
  CHECK (document_type IN ('sale', 'purchase', 'credit_note', 'debit_note'));

-- The invoice a note adjusts. Nullable, because a note may be issued without a
-- single identifiable invoice (a period rate difference, for instance).
ALTER TABLE public.business_documents
  ADD COLUMN IF NOT EXISTS original_document_id uuid
    REFERENCES public.business_documents (id);

CREATE INDEX IF NOT EXISTS idx_business_documents_original
  ON public.business_documents (original_document_id)
  WHERE original_document_id IS NOT NULL;

-- A note must adjust an invoice of the matching kind, for the same company and
-- the same party. Anything else produces a note that reports against a supply
-- it has nothing to do with.
CREATE OR REPLACE FUNCTION public.assert_note_original_document()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_original public.business_documents%ROWTYPE;
BEGIN
  IF NEW.original_document_id IS NULL THEN
    IF NEW.document_type IN ('credit_note', 'debit_note') THEN
      RETURN NEW; -- allowed, but it will not carry an invoice reference in GST
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.document_type NOT IN ('credit_note', 'debit_note') THEN
    RAISE EXCEPTION 'Only credit and debit notes may reference an original document';
  END IF;

  SELECT * INTO v_original
  FROM public.business_documents WHERE id = NEW.original_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original document not found';
  END IF;

  IF v_original.company_id <> NEW.company_id OR v_original.party_id <> NEW.party_id THEN
    RAISE EXCEPTION 'A note must adjust an invoice of the same company and party';
  END IF;

  IF NEW.document_type = 'credit_note' AND v_original.document_type <> 'sale' THEN
    RAISE EXCEPTION 'A credit note adjusts a sales invoice';
  END IF;
  IF NEW.document_type = 'debit_note' AND v_original.document_type <> 'purchase' THEN
    RAISE EXCEPTION 'A debit note adjusts a purchase invoice';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_documents_note_original ON public.business_documents;
CREATE TRIGGER trg_business_documents_note_original
BEFORE INSERT OR UPDATE OF original_document_id, document_type
ON public.business_documents
FOR EACH ROW EXECUTE FUNCTION public.assert_note_original_document();

-- ---------------------------------------------------------------------------
-- 2. Voucher types — and a repair for the silent seed
-- ---------------------------------------------------------------------------
-- seed_company_voucher_types copies rows where company_id IS NULL. When those
-- global templates are missing it copies nothing and reports success, so a
-- company ends up with no voucher types and every entry fails later with
-- "voucher type is not configured". Re-assert the templates, then backfill
-- every existing company.
INSERT INTO public.voucher_types (
  company_id, code, name, number_format, requires_location, affects_cash, affects_bank, allow_negative_cash
) VALUES
  (NULL, 'CASH-R', 'Cash Receipt', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', true, true, false, false),
  (NULL, 'CASH-P', 'Cash Payment', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', true, true, false, false),
  (NULL, 'BNK-R', 'Bank Receipt', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', false, false, true, false),
  (NULL, 'BNK-P', 'Bank Payment', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', false, false, true, false),
  (NULL, 'BNK', 'Bank Voucher', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', false, false, true, false),
  (NULL, 'JV', 'Journal Voucher', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, false, false),
  (NULL, 'CONTRA', 'Contra Voucher', '{COMPANY}-{LOCATION}-{TYPE}-{FY}-{SERIAL:6}', true, true, true, false),
  (NULL, 'SALE', 'Sales Voucher', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, false, false),
  (NULL, 'PUR', 'Purchase Voucher', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, false, false),
  (NULL, 'CRN', 'Credit Note', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, false, false),
  (NULL, 'DBN', 'Debit Note', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, false, false),
  (NULL, 'OB', 'Opening Balance', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, false, true),
  (NULL, 'ICT', 'Inter-Company Transfer', '{COMPANY}-{TYPE}-{FY}-{SERIAL:6}', false, false, true, false)
ON CONFLICT (company_id, code) DO NOTHING;

-- Give every existing company the full template set, including the new notes.
INSERT INTO public.voucher_types (
  company_id, code, name, number_format, requires_location, affects_cash, affects_bank, allow_negative_cash
)
SELECT
  c.id, t.code, t.name, t.number_format, t.requires_location,
  t.affects_cash, t.affects_bank, t.allow_negative_cash
FROM public.companies c
CROSS JOIN public.voucher_types t
WHERE t.company_id IS NULL
ON CONFLICT (company_id, code) DO NOTHING;

-- Make the silent no-op impossible from now on.
CREATE OR REPLACE FUNCTION public.seed_company_voucher_types(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_templates int;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_capability(p_company_id, 'manage');
  ELSIF NOT (
    current_user IN ('postgres', 'supabase_admin')
    OR pg_has_role(current_user, 'service_role', 'member')
  ) THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT count(*) INTO v_templates
  FROM public.voucher_types WHERE company_id IS NULL;

  IF v_templates = 0 THEN
    RAISE EXCEPTION
      'No global voucher-type templates exist; the company would be created with no voucher types';
  END IF;

  INSERT INTO public.voucher_types (
    company_id, code, name, number_format, requires_location, affects_cash, affects_bank, allow_negative_cash
  )
  SELECT
    p_company_id, code, name, number_format, requires_location, affects_cash, affects_bank, allow_negative_cash
  FROM public.voucher_types
  WHERE company_id IS NULL
  ON CONFLICT (company_id, code) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_company_voucher_types(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_company_voucher_types(uuid) TO authenticated;

COMMENT ON COLUMN public.business_documents.original_document_id IS
  'The invoice a credit or debit note adjusts. Required by GST reporting to tie the note to its original supply.';
