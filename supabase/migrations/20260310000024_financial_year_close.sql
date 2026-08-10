-- Controlled financial-year close and carry-forward through an opening voucher.
CREATE TABLE IF NOT EXISTS public.financial_year_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id),
  from_financial_year_id uuid NOT NULL UNIQUE REFERENCES public.financial_years (id),
  to_financial_year_id uuid NOT NULL REFERENCES public.financial_years (id),
  opening_voucher_id uuid NOT NULL UNIQUE REFERENCES public.vouchers (id),
  retained_earnings_ledger_id uuid NOT NULL REFERENCES public.ledgers (id),
  closed_by uuid NOT NULL REFERENCES public.profiles (id),
  closed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.financial_year_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_year_closures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_year_closures_select ON public.financial_year_closures;
CREATE POLICY financial_year_closures_select ON public.financial_year_closures FOR SELECT TO authenticated
USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));
GRANT SELECT ON public.financial_year_closures TO authenticated;

CREATE OR REPLACE FUNCTION public.close_financial_year(
  p_from_financial_year_id uuid,
  p_to_financial_year_id uuid,
  p_retained_earnings_ledger_id uuid
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_from public.financial_years%ROWTYPE;
  v_to public.financial_years%ROWTYPE;
  v_voucher public.vouchers%ROWTYPE;
  v_type_id uuid;
  v_line_no integer := 1;
  v_pl_net numeric(18,4) := 0;
  v_row record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_from FROM public.financial_years WHERE id = p_from_financial_year_id FOR UPDATE;
  SELECT * INTO v_to FROM public.financial_years WHERE id = p_to_financial_year_id;
  IF NOT FOUND OR v_from.id IS NULL THEN RAISE EXCEPTION 'Financial year not found'; END IF;
  IF v_from.company_id <> v_to.company_id OR v_to.start_date <= v_from.end_date THEN RAISE EXCEPTION 'Next financial year must follow the current year for the same company'; END IF;
  IF v_from.is_closed THEN RAISE EXCEPTION 'Financial year is already closed'; END IF;
  PERFORM public.assert_company_capability(v_from.company_id, 'manage');
  IF NOT public.has_permission('periods.lock') AND NOT public.user_has_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Missing periods.lock permission'; END IF;
  IF NOT public.has_permission('vouchers.post') AND NOT public.user_has_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Missing vouchers.post permission'; END IF;
  IF EXISTS (SELECT 1 FROM public.accounting_periods WHERE financial_year_id = v_from.id AND NOT is_locked) THEN RAISE EXCEPTION 'Lock every accounting period before closing the year'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledgers l JOIN public.account_groups g ON g.id=l.account_group_id WHERE l.id=p_retained_earnings_ledger_id AND l.company_id=v_from.company_id AND g.nature='equity') THEN RAISE EXCEPTION 'Retained earnings must be an equity ledger of the company'; END IF;
  SELECT id INTO v_type_id FROM public.voucher_types WHERE company_id=v_from.company_id AND code='OB';
  IF v_type_id IS NULL THEN RAISE EXCEPTION 'Opening Balance voucher type is missing'; END IF;

  INSERT INTO public.vouchers(company_id,financial_year_id,voucher_type_id,voucher_date,draft_ref,status,narration,created_by)
  VALUES(v_from.company_id,v_to.id,v_type_id,v_to.start_date,'DRAFT-'||substr(gen_random_uuid()::text,1,8),'draft','FY carry-forward from '||v_from.code,auth.uid()) RETURNING * INTO v_voucher;

  FOR v_row IN
    SELECT p.ledger_id, SUM(p.debit_amount-p.credit_amount)::numeric(18,4) AS net
    FROM public.ledger_postings p JOIN public.ledgers l ON l.id=p.ledger_id JOIN public.account_groups g ON g.id=l.account_group_id
    WHERE p.company_id=v_from.company_id AND p.financial_year_id=v_from.id AND g.nature IN ('asset','liability','equity') AND p.ledger_id<>p_retained_earnings_ledger_id
    GROUP BY p.ledger_id HAVING SUM(p.debit_amount-p.credit_amount)<>0
  LOOP
    INSERT INTO public.voucher_lines(voucher_id,line_no,company_id,financial_year_id,ledger_id,debit_amount,credit_amount,narration)
    VALUES(v_voucher.id,v_line_no,v_from.company_id,v_to.id,v_row.ledger_id,GREATEST(v_row.net,0),GREATEST(-v_row.net,0),'Carry-forward');
    v_line_no:=v_line_no+1;
  END LOOP;

  SELECT COALESCE(SUM(p.debit_amount-p.credit_amount),0)::numeric(18,4) INTO v_pl_net
  FROM public.ledger_postings p JOIN public.ledgers l ON l.id=p.ledger_id JOIN public.account_groups g ON g.id=l.account_group_id
  WHERE p.company_id=v_from.company_id AND p.financial_year_id=v_from.id AND g.nature IN ('income','expense');

  -- Existing retained-earnings balance plus the current-year result.
  SELECT (v_pl_net + COALESCE(SUM(p.debit_amount-p.credit_amount),0))::numeric(18,4) INTO v_pl_net
  FROM public.ledger_postings p WHERE p.company_id=v_from.company_id AND p.financial_year_id=v_from.id AND p.ledger_id=p_retained_earnings_ledger_id;
  IF v_pl_net<>0 THEN
    INSERT INTO public.voucher_lines(voucher_id,line_no,company_id,financial_year_id,ledger_id,debit_amount,credit_amount,narration)
    VALUES(v_voucher.id,v_line_no,v_from.company_id,v_to.id,p_retained_earnings_ledger_id,GREATEST(v_pl_net,0),GREATEST(-v_pl_net,0),'Retained earnings and current-year result');
  END IF;

  UPDATE public.vouchers SET status='approved',approved_by=auth.uid(),approved_at=now() WHERE id=v_voucher.id;
  v_voucher:=public.post_voucher(v_voucher.id);
  UPDATE public.financial_years SET is_closed=true WHERE id=v_from.id;
  INSERT INTO public.financial_year_closures(company_id,from_financial_year_id,to_financial_year_id,opening_voucher_id,retained_earnings_ledger_id,closed_by)
  VALUES(v_from.company_id,v_from.id,v_to.id,v_voucher.id,p_retained_earnings_ledger_id,auth.uid());
  RETURN v_voucher;
END;
$$;

REVOKE ALL ON FUNCTION public.close_financial_year(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_financial_year(uuid,uuid,uuid) TO authenticated;
