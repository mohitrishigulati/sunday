-- Daily dashboard balances and movement, calculated in PostgreSQL numeric(18,4).
-- "Closing" means the current book balance after all posted entries dated on
-- p_as_of; it is not a forecast of entries that have not yet been posted.

CREATE OR REPLACE FUNCTION public.dashboard_daily_balances(
  p_as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date)
)
RETURNS TABLE (
  as_of_date date,
  balance_kind text,
  company_id uuid,
  company_code text,
  entity_id uuid,
  entity_code text,
  entity_name text,
  opening_balance numeric(18,4),
  receipts numeric(18,4),
  payments numeric(18,4),
  closing_balance numeric(18,4),
  statement_opening numeric(18,4),
  statement_closing numeric(18,4),
  statement_book_difference numeric(18,4),
  last_statement_to date,
  statement_current boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  WITH accessible_companies AS (
    SELECT c.id, c.code
    FROM public.companies c
    WHERE c.is_active
      AND c.deleted_at IS NULL
      AND (
        public.user_has_role(ARRAY['admin'])
        OR (
          public.has_permission('reports.company')
          AND c.id IN (SELECT public.user_company_ids('read'))
        )
      )
  ),
  cash_rows AS (
    SELECT
      'cash'::text AS balance_kind,
      c.id AS company_id,
      c.code AS company_code,
      l.id AS entity_id,
      l.code AS entity_code,
      l.name AS entity_name,
      COALESCE(SUM(p.debit_amount - p.credit_amount)
        FILTER (WHERE p.voucher_date < p_as_of), 0)::numeric(18,4) AS opening_balance,
      COALESCE(SUM(p.debit_amount)
        FILTER (WHERE p.voucher_date = p_as_of), 0)::numeric(18,4) AS receipts,
      COALESCE(SUM(p.credit_amount)
        FILTER (WHERE p.voucher_date = p_as_of), 0)::numeric(18,4) AS payments
    FROM accessible_companies c
    JOIN public.locations l
      ON l.company_id = c.id
     AND l.is_active
     AND l.is_cash_location
     AND l.cash_ledger_id IS NOT NULL
    LEFT JOIN public.ledger_postings p
      ON p.company_id = c.id
     AND p.ledger_id = l.cash_ledger_id
     AND p.voucher_date <= p_as_of
    GROUP BY c.id, c.code, l.id, l.code, l.name
  ),
  latest_statements AS (
    SELECT DISTINCT ON (i.bank_account_id)
      i.bank_account_id,
      i.statement_to AS last_statement_to,
      i.opening_balance AS statement_opening,
      i.closing_balance AS statement_closing
    FROM public.bank_statement_imports i
    JOIN accessible_companies c ON c.id = i.company_id
    ORDER BY i.bank_account_id, i.statement_to DESC NULLS LAST, i.imported_at DESC
  ),
  bank_rows AS (
    SELECT
      'bank'::text AS balance_kind,
      c.id AS company_id,
      c.code AS company_code,
      b.id AS entity_id,
      RIGHT(b.account_number, 4) AS entity_code,
      b.account_name AS entity_name,
      COALESCE(SUM(p.debit_amount - p.credit_amount)
        FILTER (WHERE p.voucher_date < p_as_of), 0)::numeric(18,4) AS opening_balance,
      COALESCE(SUM(p.debit_amount)
        FILTER (WHERE p.voucher_date = p_as_of), 0)::numeric(18,4) AS receipts,
      COALESCE(SUM(p.credit_amount)
        FILTER (WHERE p.voucher_date = p_as_of), 0)::numeric(18,4) AS payments,
      sd.last_statement_to,
      sd.statement_opening,
      sd.statement_closing
    FROM accessible_companies c
    JOIN public.bank_accounts b
      ON b.company_id = c.id
     AND b.is_active
     AND b.deleted_at IS NULL
    LEFT JOIN public.ledger_postings p
      ON p.company_id = c.id
     AND p.ledger_id = b.ledger_id
     AND p.voucher_date <= p_as_of
    LEFT JOIN latest_statements sd ON sd.bank_account_id = b.id
    GROUP BY c.id, c.code, b.id, b.account_number, b.account_name,
      sd.last_statement_to, sd.statement_opening, sd.statement_closing
  )
  SELECT
    p_as_of,
    c.balance_kind,
    c.company_id,
    c.company_code,
    c.entity_id,
    c.entity_code,
    c.entity_name,
    c.opening_balance,
    c.receipts,
    c.payments,
    (c.opening_balance + c.receipts - c.payments)::numeric(18,4),
    NULL::numeric(18,4),
    NULL::numeric(18,4),
    NULL::numeric(18,4),
    NULL::date,
    true
  FROM cash_rows c
  UNION ALL
  SELECT
    p_as_of,
    b.balance_kind,
    b.company_id,
    b.company_code,
    b.entity_id,
    b.entity_code,
    b.entity_name,
    b.opening_balance,
    b.receipts,
    b.payments,
    (b.opening_balance + b.receipts - b.payments)::numeric(18,4),
    b.statement_opening,
    b.statement_closing,
    CASE WHEN b.statement_closing IS NULL THEN NULL
      ELSE (b.statement_closing - (b.opening_balance + b.receipts - b.payments))::numeric(18,4)
    END,
    b.last_statement_to,
    COALESCE(b.last_statement_to >= p_as_of, false)
  FROM bank_rows b;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_daily_summary(
  p_as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date)
)
RETURNS TABLE (
  as_of_date date,
  cash_opening numeric(18,4),
  cash_receipts numeric(18,4),
  cash_payments numeric(18,4),
  cash_closing numeric(18,4),
  bank_opening numeric(18,4),
  bank_receipts numeric(18,4),
  bank_payments numeric(18,4),
  bank_closing numeric(18,4),
  total_opening numeric(18,4),
  total_receipts numeric(18,4),
  total_payments numeric(18,4),
  total_closing numeric(18,4),
  missing_statement_accounts integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    p_as_of,
    COALESCE(SUM(d.opening_balance) FILTER (WHERE d.balance_kind = 'cash'), 0)::numeric(18,4),
    COALESCE(SUM(d.receipts) FILTER (WHERE d.balance_kind = 'cash'), 0)::numeric(18,4),
    COALESCE(SUM(d.payments) FILTER (WHERE d.balance_kind = 'cash'), 0)::numeric(18,4),
    COALESCE(SUM(d.closing_balance) FILTER (WHERE d.balance_kind = 'cash'), 0)::numeric(18,4),
    COALESCE(SUM(d.opening_balance) FILTER (WHERE d.balance_kind = 'bank'), 0)::numeric(18,4),
    COALESCE(SUM(d.receipts) FILTER (WHERE d.balance_kind = 'bank'), 0)::numeric(18,4),
    COALESCE(SUM(d.payments) FILTER (WHERE d.balance_kind = 'bank'), 0)::numeric(18,4),
    COALESCE(SUM(d.closing_balance) FILTER (WHERE d.balance_kind = 'bank'), 0)::numeric(18,4),
    COALESCE(SUM(d.opening_balance), 0)::numeric(18,4),
    COALESCE(SUM(d.receipts), 0)::numeric(18,4),
    COALESCE(SUM(d.payments), 0)::numeric(18,4),
    COALESCE(SUM(d.closing_balance), 0)::numeric(18,4),
    COUNT(*) FILTER (
      WHERE d.balance_kind = 'bank' AND NOT d.statement_current
    )::integer
  FROM public.dashboard_daily_balances(p_as_of) d;
$$;

REVOKE ALL ON FUNCTION public.dashboard_daily_balances(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_daily_summary(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_daily_balances(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_daily_summary(date) TO authenticated;

COMMENT ON FUNCTION public.dashboard_daily_balances(date) IS
  'Location-wise cash and account-wise bank opening, daily movement and current closing balance for accessible companies.';
COMMENT ON FUNCTION public.dashboard_daily_summary(date) IS
  'Exact-decimal daily cash/bank movement summary and count of active bank accounts without a statement through the selected date.';
