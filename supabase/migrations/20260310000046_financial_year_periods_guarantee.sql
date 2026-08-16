-- Every financial year must have accounting periods, always.
--
-- trg_vouchers_period_insert calls assert_period_open on every voucher insert,
-- which raises 'No accounting period covers date ...' when the year has no
-- period rows. A financial year without periods therefore silently blocks every
-- entry dated in it — cash receipts and payments, journals, contras, invoices,
-- payroll, opening balances, all of them. The save simply fails and no draft is
-- kept.
--
-- Period creation used to depend on the caller remembering to invoke
-- create_monthly_periods, and on that call succeeding: it requires the `manage`
-- capability while creating a year only requires `write`, and its result was
-- discarded by the application. Years created by SQL Editor, by a seed script,
-- or by a `write`-only user ended up with no periods and no error.
--
-- Periods are now an automatic consequence of the year existing.

CREATE OR REPLACE FUNCTION public.ensure_financial_year_periods(p_financial_year_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_fy public.financial_years%ROWTYPE;
  v_period int := 1;
  v_month_start date;
  v_month_end date;
  v_created int := 0;
BEGIN
  SELECT * INTO v_fy FROM public.financial_years WHERE id = p_financial_year_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Financial year not found';
  END IF;

  -- No capability check: creating the year was already authorised, and the
  -- periods are simply the calendar months that year spans. This function is
  -- not granted to clients; it is reached through the trigger below.
  v_month_start := date_trunc('month', v_fy.start_date)::date;
  IF v_month_start < v_fy.start_date THEN
    v_month_start := v_fy.start_date;
  END IF;

  WHILE v_month_start <= v_fy.end_date LOOP
    v_month_end := (date_trunc('month', v_month_start) + interval '1 month - 1 day')::date;
    IF v_month_end > v_fy.end_date THEN
      v_month_end := v_fy.end_date;
    END IF;

    INSERT INTO public.accounting_periods (
      financial_year_id, company_id, period_no, start_date, end_date
    ) VALUES (
      v_fy.id, v_fy.company_id, v_period, v_month_start, v_month_end
    )
    ON CONFLICT (financial_year_id, period_no) DO NOTHING;

    IF FOUND THEN
      v_created := v_created + 1;
    END IF;

    v_period := v_period + 1;
    v_month_start := (date_trunc('month', v_month_start) + interval '1 month')::date;
  END LOOP;

  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_financial_year_periods(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_financial_years_create_periods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_financial_year_periods(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_financial_years_periods ON public.financial_years;
CREATE TRIGGER trg_financial_years_periods
AFTER INSERT ON public.financial_years
FOR EACH ROW EXECUTE FUNCTION public.trg_financial_years_create_periods();

-- Repair every existing year that has no periods. Locked periods and any manual
-- period edits are untouched, because the insert is ON CONFLICT DO NOTHING and
-- only years with zero periods are visited.
DO $$
DECLARE
  v_id uuid;
  v_total int := 0;
  v_made int;
BEGIN
  FOR v_id IN
    SELECT fy.id
    FROM public.financial_years fy
    WHERE NOT EXISTS (
      SELECT 1 FROM public.accounting_periods p WHERE p.financial_year_id = fy.id
    )
  LOOP
    v_made := public.ensure_financial_year_periods(v_id);
    v_total := v_total + v_made;
  END LOOP;

  IF v_total > 0 THEN
    RAISE NOTICE 'Backfilled % accounting periods for years that had none', v_total;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.ensure_financial_year_periods(uuid) IS
  'Creates the monthly accounting periods a financial year spans. Idempotent; invoked automatically when a financial year is inserted.';
