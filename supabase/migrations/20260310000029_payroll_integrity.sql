ALTER TABLE public.salary_register
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE OR REPLACE FUNCTION public.validate_salary_register()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_year public.financial_years%ROWTYPE; v_group_id uuid; v_party_group uuid; v_voucher public.vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v_year FROM public.financial_years WHERE id=NEW.financial_year_id;
  SELECT group_id INTO v_group_id FROM public.companies WHERE id=NEW.company_id;
  SELECT group_id INTO v_party_group FROM public.parties WHERE id=NEW.employee_party_id AND 'employee'=ANY(party_kinds);
  IF v_year.id IS NULL OR v_year.company_id<>NEW.company_id OR NEW.salary_month NOT BETWEEN v_year.start_date AND v_year.end_date THEN RAISE EXCEPTION 'Salary financial year/month does not match company'; END IF;
  IF v_party_group IS NULL OR v_party_group<>v_group_id THEN RAISE EXCEPTION 'Employee party does not belong to the company group'; END IF;
  IF NEW.location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.locations WHERE id=NEW.location_id AND company_id=NEW.company_id) THEN RAISE EXCEPTION 'Salary location belongs to another company'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status='paid' THEN RAISE EXCEPTION 'Paid salary entry is immutable'; END IF;
    IF NEW.status<>OLD.status AND NOT ((OLD.status='draft' AND NEW.status='approved') OR (OLD.status='approved' AND NEW.status='paid')) THEN RAISE EXCEPTION 'Salary status must progress draft to approved to paid'; END IF;
  END IF;
  IF (TG_OP='INSERT' AND NEW.status<>'draft') OR (TG_OP='UPDATE' AND OLD.status='draft' AND NEW.status='approved') THEN
    IF NOT public.has_permission('vouchers.approve') AND NOT public.user_has_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Missing approval permission'; END IF;
    PERFORM public.assert_company_capability(NEW.company_id,'approve');
    IF NEW.created_by=auth.uid() AND NOT public.user_has_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Maker cannot approve own salary entry'; END IF;
    NEW.approved_by:=auth.uid(); NEW.approved_at:=now();
  END IF;
  IF NEW.status='paid' THEN
    SELECT * INTO v_voucher FROM public.vouchers WHERE id=NEW.payment_voucher_id;
    IF v_voucher.id IS NULL OR v_voucher.company_id<>NEW.company_id OR v_voucher.status<>'posted' THEN RAISE EXCEPTION 'Salary payment voucher must be posted in the same company'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_salary_register ON public.salary_register;
CREATE TRIGGER trg_validate_salary_register BEFORE INSERT OR UPDATE ON public.salary_register FOR EACH ROW EXECUTE FUNCTION public.validate_salary_register();

CREATE OR REPLACE FUNCTION public.prevent_paid_salary_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN IF OLD.status='paid' THEN RAISE EXCEPTION 'Paid salary entry cannot be deleted'; END IF; RETURN OLD; END; $$;
DROP TRIGGER IF EXISTS trg_prevent_paid_salary_delete ON public.salary_register;
CREATE TRIGGER trg_prevent_paid_salary_delete BEFORE DELETE ON public.salary_register FOR EACH ROW EXECUTE FUNCTION public.prevent_paid_salary_delete();
