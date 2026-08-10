-- Atomic, re-runnable posted-voucher immutability controls.
CREATE OR REPLACE FUNCTION public.prevent_posted_voucher_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'approved', 'reversed') THEN
      RAISE EXCEPTION 'Cannot delete voucher in status %', OLD.status;
    END IF;
    IF EXISTS (SELECT 1 FROM public.ledger_postings WHERE voucher_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot delete voucher with ledger postings';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' THEN
    IF NEW.reversed_by_voucher_id IS DISTINCT FROM OLD.reversed_by_voucher_id
       AND NEW.status = 'reversed'
       AND NEW.voucher_number IS NOT DISTINCT FROM OLD.voucher_number
       AND NEW.company_id = OLD.company_id
       AND NEW.voucher_date = OLD.voucher_date
       AND NEW.voucher_type_id = OLD.voucher_type_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Posted vouchers are immutable';
  END IF;

  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'Reversed vouchers are immutable';
  END IF;

  PERFORM public.assert_period_open(NEW.company_id, NEW.voucher_date);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_voucher_line_mutation_when_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_voucher_id uuid;
BEGIN
  v_voucher_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.voucher_id ELSE NEW.voucher_id END;
  SELECT status INTO v_status FROM public.vouchers WHERE id = v_voucher_id;
  IF v_status IN ('posted', 'reversed', 'approved') THEN
    RAISE EXCEPTION 'Cannot modify lines of voucher in status %', v_status;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_ledger_posting_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Ledger postings are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_vouchers_immutability ON public.vouchers;
CREATE TRIGGER trg_vouchers_immutability
BEFORE UPDATE OR DELETE ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.prevent_posted_voucher_mutation();

DROP TRIGGER IF EXISTS trg_voucher_lines_posted_guard ON public.voucher_lines;
CREATE TRIGGER trg_voucher_lines_posted_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.voucher_lines
FOR EACH ROW EXECUTE FUNCTION public.prevent_voucher_line_mutation_when_posted();

DROP TRIGGER IF EXISTS trg_ledger_postings_immutable ON public.ledger_postings;
CREATE TRIGGER trg_ledger_postings_immutable
BEFORE UPDATE OR DELETE ON public.ledger_postings
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_posting_mutation();
