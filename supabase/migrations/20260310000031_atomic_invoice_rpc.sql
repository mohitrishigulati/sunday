-- P0 accounting integrity, part 2: invoice creation becomes one atomic RPC with
-- exact-decimal money.
--
-- Two defects this replaces:
--
-- 1. Every invoice amount was computed in JavaScript IEEE-754 doubles
--    (quantity * rate, taxable * gstRate / 100, tax / 2, and .reduce() sums,
--    each rounded with .toFixed(4)). Doubles cannot represent 0.1 exactly, so
--    line sums drifted from the header total, and the CGST/SGST halves did not
--    always re-add to the tax they were split from.
--
-- 2. Creation was five sequential statements from the app (attachment, voucher,
--    voucher_lines, business_documents, business_document_lines) with manual
--    compensating deletes. A crash or a failed compensating delete left an
--    orphan voucher or a document with no lines. A function body is a single
--    transaction, so any exception now rolls the whole invoice back.
--
-- All arithmetic below is numeric(18,4). The CGST/SGST split assigns the
-- remainder to SGST so the two halves always re-add to the line tax exactly.

CREATE OR REPLACE FUNCTION public.create_business_document(p_payload jsonb)
RETURNS public.business_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_company_id uuid := (p_payload ->> 'company_id')::uuid;
  v_financial_year_id uuid := (p_payload ->> 'financial_year_id')::uuid;
  v_document_type text := p_payload ->> 'document_type';
  v_document_number text := p_payload ->> 'document_number';
  v_document_date date := (p_payload ->> 'document_date')::date;
  v_due_date date := (p_payload ->> 'due_date')::date;
  v_party_id uuid := (p_payload ->> 'party_id')::uuid;
  v_party_ledger_id uuid := (p_payload ->> 'party_ledger_id')::uuid;
  v_place_of_supply text := NULLIF(p_payload ->> 'place_of_supply', '');
  v_is_interstate boolean := COALESCE((p_payload ->> 'is_interstate')::boolean, false);
  v_cgst_ledger_id uuid := NULLIF(p_payload ->> 'cgst_ledger_id', '')::uuid;
  v_sgst_ledger_id uuid := NULLIF(p_payload ->> 'sgst_ledger_id', '')::uuid;
  v_igst_ledger_id uuid := NULLIF(p_payload ->> 'igst_ledger_id', '')::uuid;
  v_tds_ledger_id uuid := NULLIF(p_payload ->> 'tds_ledger_id', '')::uuid;
  v_round_off_ledger_id uuid := NULLIF(p_payload ->> 'round_off_ledger_id', '')::uuid;
  v_tds_section text := NULLIF(p_payload ->> 'tds_section', '');
  v_tds_rate numeric(8,4) := COALESCE((p_payload ->> 'tds_rate')::numeric, 0);
  v_round_off numeric(18,4) := COALESCE((p_payload ->> 'round_off')::numeric, 0);
  v_eway_bill_no text := NULLIF(p_payload ->> 'eway_bill_no', '');
  v_narration text := NULLIF(p_payload ->> 'narration', '');
  v_attachment jsonb := p_payload -> 'attachment';
  v_items jsonb := p_payload -> 'items';

  v_is_sale boolean;
  v_voucher_type public.voucher_types%ROWTYPE;
  v_attachment_id uuid;
  v_voucher public.vouchers%ROWTYPE;
  v_document public.business_documents%ROWTYPE;

  v_item jsonb;
  v_index integer := 0;
  v_line_no integer := 0;
  v_quantity numeric(18,4);
  v_rate numeric(18,4);
  v_discount numeric(18,4);
  v_gst_rate numeric(8,4);
  v_line_subtotal numeric(18,4);
  v_line_taxable numeric(18,4);
  v_line_tax numeric(18,4);
  v_line_cgst numeric(18,4);
  v_line_sgst numeric(18,4);
  v_line_igst numeric(18,4);

  v_subtotal numeric(18,4) := 0;
  v_discount_total numeric(18,4) := 0;
  v_taxable numeric(18,4) := 0;
  v_cgst numeric(18,4) := 0;
  v_sgst numeric(18,4) := 0;
  v_igst numeric(18,4) := 0;
  v_tds numeric(18,4) := 0;
  v_total numeric(18,4);
  v_round_debit boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_document_type NOT IN ('sale', 'purchase') THEN
    RAISE EXCEPTION 'Document type must be sale or purchase';
  END IF;
  -- This RPC is reachable directly over PostgREST, so it re-validates
  -- everything the form validates rather than trusting the caller.
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array'
     OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Invoice must have at least one line';
  END IF;
  IF jsonb_array_length(v_items) > 200 THEN
    RAISE EXCEPTION 'An invoice cannot exceed 200 lines';
  END IF;
  IF coalesce(btrim(v_document_number), '') = '' THEN
    RAISE EXCEPTION 'Document number is required';
  END IF;
  IF v_due_date < v_document_date THEN
    RAISE EXCEPTION 'Due date cannot precede the document date';
  END IF;
  IF v_tds_rate < 0 OR v_tds_rate > 100 THEN
    RAISE EXCEPTION 'TDS rate must be between 0 and 100';
  END IF;
  IF v_place_of_supply IS NOT NULL AND length(v_place_of_supply) <> 2 THEN
    RAISE EXCEPTION 'Place of supply must be a two-character state code';
  END IF;

  v_is_sale := v_document_type = 'sale';

  PERFORM public.assert_company_capability(v_company_id, 'write');
  PERFORM public.assert_period_open(v_company_id, v_document_date);

  IF NOT public.has_permission('vouchers.draft')
     AND NOT public.user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Missing vouchers.draft permission';
  END IF;

  -- The document date must fall inside the financial year it is filed under,
  -- otherwise the invoice lands in a year whose reports will never show it.
  IF NOT EXISTS (
    SELECT 1 FROM public.financial_years
    WHERE id = v_financial_year_id
      AND company_id = v_company_id
      AND v_document_date BETWEEN start_date AND end_date
  ) THEN
    RAISE EXCEPTION
      'Document date % is outside the selected financial year for this company',
      v_document_date;
  END IF;

  -- The party must belong to this company's group.
  IF NOT EXISTS (
    SELECT 1
    FROM public.parties p
    JOIN public.companies c ON c.group_id = p.group_id
    WHERE p.id = v_party_id AND c.id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Party does not belong to this company group';
  END IF;

  -- Tax, TDS and round-off ledgers must also be this company's ledgers.
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      v_cgst_ledger_id, v_sgst_ledger_id, v_igst_ledger_id,
      v_tds_ledger_id, v_round_off_ledger_id
    ]) AS wanted(id)
    WHERE wanted.id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.ledgers
        WHERE ledgers.id = wanted.id
          AND ledgers.company_id = v_company_id
          AND ledgers.is_active
          AND ledgers.deleted_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'A tax, TDS or round-off ledger does not belong to this company';
  END IF;

  SELECT * INTO v_voucher_type
  FROM public.voucher_types
  WHERE company_id = v_company_id
    AND code = CASE WHEN v_is_sale THEN 'SALE' ELSE 'PUR' END;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher type % is not seeded for this company',
      CASE WHEN v_is_sale THEN 'SALE' ELSE 'PUR' END;
  END IF;

  -- The party ledger must be this company's ledger and linked to this party.
  IF NOT EXISTS (
    SELECT 1 FROM public.ledgers
    WHERE id = v_party_ledger_id
      AND company_id = v_company_id
      AND party_id = v_party_id
      AND is_active
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Party ledger is not an active ledger of this company linked to the party';
  END IF;

  -- ------------------------------------------------------------------
  -- Line arithmetic, entirely in numeric(18,4)
  -- ------------------------------------------------------------------
  CREATE TEMP TABLE tmp_document_lines (
    line_no integer,
    description text,
    hsn_sac text,
    quantity numeric(18,4),
    unit text,
    rate numeric(18,4),
    discount_amount numeric(18,4),
    taxable_amount numeric(18,4),
    gst_rate numeric(8,4),
    cgst_amount numeric(18,4),
    sgst_amount numeric(18,4),
    igst_amount numeric(18,4),
    trade_ledger_id uuid,
    cost_centre_id uuid,
    salesman_id uuid
  ) ON COMMIT DROP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    v_index := v_index + 1;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_rate := (v_item ->> 'rate')::numeric;
    v_discount := COALESCE((v_item ->> 'discount_amount')::numeric, 0);
    v_gst_rate := COALESCE((v_item ->> 'gst_rate')::numeric, 0);

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Line % quantity must be greater than zero', v_index;
    END IF;
    IF v_rate < 0 OR v_discount < 0 THEN
      RAISE EXCEPTION 'Line % rate and discount cannot be negative', v_index;
    END IF;
    IF v_gst_rate < 0 OR v_gst_rate > 100 THEN
      RAISE EXCEPTION 'Line % GST rate must be between 0 and 100', v_index;
    END IF;
    IF coalesce(btrim(v_item ->> 'description'), '') = '' THEN
      RAISE EXCEPTION 'Line % description is required', v_index;
    END IF;
    IF coalesce(btrim(v_item ->> 'unit'), '') = '' THEN
      RAISE EXCEPTION 'Line % unit is required', v_index;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.ledgers
      WHERE id = (v_item ->> 'trade_ledger_id')::uuid
        AND company_id = v_company_id
        AND is_active
        AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Line % trade ledger does not belong to this company', v_index;
    END IF;

    -- Cost centres are company-scoped; salesmen are shared across the group.
    IF NULLIF(v_item ->> 'cost_centre_id', '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.cost_centres
         WHERE id = (v_item ->> 'cost_centre_id')::uuid
           AND company_id = v_company_id
       ) THEN
      RAISE EXCEPTION 'Line % cost centre does not belong to this company', v_index;
    END IF;
    IF NULLIF(v_item ->> 'salesman_id', '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.salesmen s
         JOIN public.companies c ON c.group_id = s.group_id
         WHERE s.id = (v_item ->> 'salesman_id')::uuid
           AND c.id = v_company_id
       ) THEN
      RAISE EXCEPTION 'Line % salesman does not belong to this company group', v_index;
    END IF;

    v_line_subtotal := round(v_quantity * v_rate, 4);
    IF v_discount > v_line_subtotal THEN
      RAISE EXCEPTION 'Line % discount exceeds its amount', v_index;
    END IF;
    v_line_taxable := round(v_line_subtotal - v_discount, 4);
    v_line_tax := round(v_line_taxable * v_gst_rate / 100, 4);

    IF v_is_interstate THEN
      v_line_cgst := 0;
      v_line_sgst := 0;
      v_line_igst := v_line_tax;
    ELSE
      -- Give the odd sub-paisa to SGST so the halves re-add to the tax exactly.
      v_line_cgst := round(v_line_tax / 2, 4);
      v_line_sgst := v_line_tax - v_line_cgst;
      v_line_igst := 0;
    END IF;

    v_line_no := v_line_no + 1;
    INSERT INTO tmp_document_lines VALUES (
      v_line_no,
      v_item ->> 'description',
      NULLIF(v_item ->> 'hsn_sac', ''),
      v_quantity,
      COALESCE(NULLIF(v_item ->> 'unit', ''), 'NOS'),
      v_rate,
      v_discount,
      v_line_taxable,
      v_gst_rate,
      v_line_cgst,
      v_line_sgst,
      v_line_igst,
      (v_item ->> 'trade_ledger_id')::uuid,
      NULLIF(v_item ->> 'cost_centre_id', '')::uuid,
      NULLIF(v_item ->> 'salesman_id', '')::uuid
    );

    v_subtotal := v_subtotal + v_line_subtotal;
    v_discount_total := v_discount_total + v_discount;
    v_taxable := v_taxable + v_line_taxable;
    v_cgst := v_cgst + v_line_cgst;
    v_sgst := v_sgst + v_line_sgst;
    v_igst := v_igst + v_line_igst;
  END LOOP;

  v_tds := round(v_taxable * v_tds_rate / 100, 4);
  v_total := round(v_taxable + v_cgst + v_sgst + v_igst + v_round_off - v_tds, 4);

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Document total must be greater than zero';
  END IF;
  IF abs(v_round_off) > 10 THEN
    RAISE EXCEPTION 'Round-off beyond +/- 10 is not an adjustment';
  END IF;
  IF v_cgst > 0 AND (v_cgst_ledger_id IS NULL OR v_sgst_ledger_id IS NULL) THEN
    RAISE EXCEPTION 'CGST and SGST ledgers are required';
  END IF;
  IF v_igst > 0 AND v_igst_ledger_id IS NULL THEN
    RAISE EXCEPTION 'IGST ledger is required';
  END IF;
  IF v_tds > 0 AND v_tds_ledger_id IS NULL THEN
    RAISE EXCEPTION 'TDS ledger is required';
  END IF;
  IF v_round_off <> 0 AND v_round_off_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Round-off ledger is required when round-off is non-zero';
  END IF;

  -- ------------------------------------------------------------------
  -- Attachment, voucher, ledger lines, document, document lines
  -- ------------------------------------------------------------------
  IF v_attachment IS NOT NULL AND v_attachment <> 'null'::jsonb THEN
    IF left(v_attachment ->> 'storage_path', length(v_company_id::text) + 1)
       <> v_company_id::text || '/' THEN
      RAISE EXCEPTION 'Attachment path does not match the selected company';
    END IF;
    IF coalesce(btrim(v_attachment ->> 'file_name'), '') = ''
       OR length(v_attachment ->> 'file_name') > 255 THEN
      RAISE EXCEPTION 'Attachment file name is required and must be at most 255 characters';
    END IF;
    IF length(v_attachment ->> 'storage_path') > 1000 THEN
      RAISE EXCEPTION 'Attachment storage path is too long';
    END IF;
    -- The hash identifies the stored object; a malformed one makes the private
    -- bucket row unverifiable against its file.
    IF coalesce(v_attachment ->> 'file_hash', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Attachment file hash must be a 64-character SHA-256 hex digest';
    END IF;
    INSERT INTO public.attachments (
      company_id, storage_path, file_name, mime_type, file_hash, uploaded_by
    ) VALUES (
      v_company_id,
      v_attachment ->> 'storage_path',
      v_attachment ->> 'file_name',
      NULLIF(v_attachment ->> 'mime_type', ''),
      v_attachment ->> 'file_hash',
      auth.uid()
    )
    RETURNING id INTO v_attachment_id;
  END IF;

  INSERT INTO public.vouchers (
    company_id, financial_year_id, voucher_type_id, voucher_date, draft_ref,
    status, party_id, narration, created_by, attachment_id, gst_invoice_no,
    gst_invoice_date, place_of_supply, is_interstate, eway_bill_no
  ) VALUES (
    v_company_id, v_financial_year_id, v_voucher_type.id, v_document_date,
    'DRAFT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'draft', v_party_id,
    COALESCE(v_narration, initcap(v_document_type) || ' invoice ' || v_document_number),
    auth.uid(), v_attachment_id, v_document_number, v_document_date,
    v_place_of_supply, v_is_interstate, v_eway_bill_no
  )
  RETURNING * INTO v_voucher;

  -- Party control line carries the full invoice value.
  INSERT INTO public.voucher_lines (
    voucher_id, line_no, company_id, financial_year_id, ledger_id, party_id,
    debit_amount, credit_amount, narration
  ) VALUES (
    v_voucher.id, 1, v_company_id, v_financial_year_id, v_party_ledger_id,
    v_party_id,
    CASE WHEN v_is_sale THEN v_total ELSE 0 END,
    CASE WHEN v_is_sale THEN 0 ELSE v_total END,
    v_document_number
  );
  v_line_no := 1;

  FOR v_item IN
    SELECT to_jsonb(t) FROM tmp_document_lines t ORDER BY t.line_no
  LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.voucher_lines (
      voucher_id, line_no, company_id, financial_year_id, ledger_id, party_id,
      cost_centre_id, salesman_id, debit_amount, credit_amount, narration,
      hsn_sac, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount
    ) VALUES (
      v_voucher.id, v_line_no, v_company_id, v_financial_year_id,
      (v_item ->> 'trade_ledger_id')::uuid, v_party_id,
      NULLIF(v_item ->> 'cost_centre_id', '')::uuid,
      NULLIF(v_item ->> 'salesman_id', '')::uuid,
      CASE WHEN v_is_sale THEN 0 ELSE (v_item ->> 'taxable_amount')::numeric END,
      CASE WHEN v_is_sale THEN (v_item ->> 'taxable_amount')::numeric ELSE 0 END,
      v_item ->> 'description',
      NULLIF(v_item ->> 'hsn_sac', ''),
      (v_item ->> 'taxable_amount')::numeric,
      (v_item ->> 'cgst_amount')::numeric,
      (v_item ->> 'sgst_amount')::numeric,
      (v_item ->> 'igst_amount')::numeric,
      0
    );
  END LOOP;

  FOR v_item IN
    SELECT jsonb_build_object('ledger_id', l.ledger_id, 'value', l.value)
    FROM (VALUES
      (v_cgst_ledger_id, v_cgst),
      (v_sgst_ledger_id, v_sgst),
      (v_igst_ledger_id, v_igst)
    ) AS l(ledger_id, value)
    WHERE l.ledger_id IS NOT NULL AND l.value > 0
  LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.voucher_lines (
      voucher_id, line_no, company_id, financial_year_id, ledger_id,
      debit_amount, credit_amount, narration
    ) VALUES (
      v_voucher.id, v_line_no, v_company_id, v_financial_year_id,
      (v_item ->> 'ledger_id')::uuid,
      CASE WHEN v_is_sale THEN 0 ELSE (v_item ->> 'value')::numeric END,
      CASE WHEN v_is_sale THEN (v_item ->> 'value')::numeric ELSE 0 END,
      v_document_number
    );
  END LOOP;

  IF v_tds > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.voucher_lines (
      voucher_id, line_no, company_id, financial_year_id, ledger_id,
      debit_amount, credit_amount, narration
    ) VALUES (
      v_voucher.id, v_line_no, v_company_id, v_financial_year_id, v_tds_ledger_id,
      CASE WHEN v_is_sale THEN v_tds ELSE 0 END,
      CASE WHEN v_is_sale THEN 0 ELSE v_tds END,
      'TDS ' || COALESCE(v_tds_section, '')
    );
  END IF;

  IF v_round_off <> 0 THEN
    v_round_debit := (v_is_sale AND v_round_off < 0) OR (NOT v_is_sale AND v_round_off > 0);
    v_line_no := v_line_no + 1;
    INSERT INTO public.voucher_lines (
      voucher_id, line_no, company_id, financial_year_id, ledger_id,
      debit_amount, credit_amount, narration
    ) VALUES (
      v_voucher.id, v_line_no, v_company_id, v_financial_year_id,
      v_round_off_ledger_id,
      CASE WHEN v_round_debit THEN abs(v_round_off) ELSE 0 END,
      CASE WHEN v_round_debit THEN 0 ELSE abs(v_round_off) END,
      'Invoice round-off'
    );
  END IF;

  INSERT INTO public.business_documents (
    voucher_id, company_id, financial_year_id, party_id, document_type,
    document_number, document_date, due_date, place_of_supply, is_interstate,
    subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount,
    igst_amount, tds_section, tds_rate, tds_amount, round_off, total_amount,
    eway_bill_no, created_by
  ) VALUES (
    v_voucher.id, v_company_id, v_financial_year_id, v_party_id, v_document_type,
    v_document_number, v_document_date, v_due_date, v_place_of_supply,
    v_is_interstate, v_subtotal, v_discount_total, v_taxable, v_cgst, v_sgst,
    v_igst, v_tds_section, v_tds_rate, v_tds, v_round_off, v_total,
    v_eway_bill_no, auth.uid()
  )
  RETURNING * INTO v_document;

  INSERT INTO public.business_document_lines (
    document_id, line_no, description, hsn_sac, quantity, unit, rate,
    discount_amount, taxable_amount, gst_rate, cgst_amount, sgst_amount,
    igst_amount, cess_amount, trade_ledger_id, cost_centre_id, salesman_id
  )
  SELECT
    v_document.id, t.line_no, t.description, t.hsn_sac, t.quantity, t.unit,
    t.rate, t.discount_amount, t.taxable_amount, t.gst_rate, t.cgst_amount,
    t.sgst_amount, t.igst_amount, 0, t.trade_ledger_id, t.cost_centre_id,
    t.salesman_id
  FROM tmp_document_lines t
  ORDER BY t.line_no;

  -- The voucher this invoice will post must already balance to its own header.
  IF (SELECT round(SUM(debit_amount) - SUM(credit_amount), 4)
      FROM public.voucher_lines WHERE voucher_id = v_voucher.id) <> 0 THEN
    RAISE EXCEPTION 'Invoice ledger lines do not balance against the invoice total';
  END IF;

  DROP TABLE IF EXISTS tmp_document_lines;
  RETURN v_document;
END;
$$;

REVOKE ALL ON FUNCTION public.create_business_document(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_document(jsonb) TO authenticated;

COMMENT ON FUNCTION public.create_business_document(jsonb) IS
  'Atomically creates an invoice: attachment, voucher, ledger lines, document and document lines. All money is numeric(18,4); the CGST/SGST split re-adds to the line tax exactly.';
