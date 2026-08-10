-- Deferred balance validation must see postings regardless of the caller's RLS scope.
CREATE OR REPLACE FUNCTION public.assert_voucher_balanced(p_voucher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dr numeric(18, 4);
  v_cr numeric(18, 4);
BEGIN
  SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
  INTO v_dr, v_cr
  FROM public.ledger_postings
  WHERE voucher_id = p_voucher_id;

  IF v_dr <> v_cr THEN
    RAISE EXCEPTION 'Voucher % is out of balance: debit % credit %',
      p_voucher_id, v_dr, v_cr;
  END IF;

  IF v_dr = 0 THEN
    RAISE EXCEPTION 'Voucher % has no postings', p_voucher_id;
  END IF;
END;
$$;
