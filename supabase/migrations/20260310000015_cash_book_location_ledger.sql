-- Phase 2: every cash location is linked to one company-owned cash ledger.
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS cash_ledger_id uuid REFERENCES public.ledgers (id);

CREATE OR REPLACE FUNCTION public.assert_location_cash_ledger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ledger public.ledgers%ROWTYPE;
BEGIN
  IF NEW.cash_ledger_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ledger FROM public.ledgers WHERE id = NEW.cash_ledger_id;
  IF NOT FOUND OR v_ledger.company_id <> NEW.company_id OR v_ledger.ledger_type <> 'cash'
     OR v_ledger.deleted_at IS NOT NULL OR NOT v_ledger.is_active THEN
    RAISE EXCEPTION 'cash_ledger_id must reference an active cash ledger in the same company';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_locations_cash_ledger ON public.locations;
CREATE TRIGGER trg_locations_cash_ledger
BEFORE INSERT OR UPDATE OF company_id, cash_ledger_id ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.assert_location_cash_ledger();

CREATE INDEX IF NOT EXISTS idx_locations_cash_ledger
  ON public.locations (cash_ledger_id)
  WHERE cash_ledger_id IS NOT NULL;
