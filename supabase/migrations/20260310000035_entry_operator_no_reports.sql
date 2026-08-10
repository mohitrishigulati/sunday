-- Entry Operator: may prepare accounting entries for explicitly granted
-- companies, but may not approve/post, view statements or read report data.
UPDATE public.roles
SET name = 'Entry Operator — Entries Only (No Statements / Reports)',
    permissions = '{
      "masters.write": false,
      "vouchers.draft": true,
      "vouchers.submit": true,
      "vouchers.approve": false,
      "vouchers.post": false,
      "cash.write": true,
      "bank.import": false,
      "bank.statements.view": false,
      "reports.company": false,
      "reports.consolidated": false,
      "users.manage": false,
      "periods.lock": false
    }'::jsonb
WHERE code = 'data_entry';

-- Make the statement permission explicit for all standard roles. This avoids
-- an omitted JSON key being interpreted differently by different screens.
UPDATE public.roles
SET permissions = permissions || jsonb_build_object(
  'bank.statements.view',
  code IN ('accountant', 'approver', 'admin', 'management')
)
WHERE code IN ('cashier', 'accountant', 'approver', 'admin', 'management');

-- Posted ledger data is report data. Company read access alone is deliberately
-- insufficient for Entry Operators; reports.company is additionally required.
DROP POLICY IF EXISTS ledger_postings_select ON public.ledger_postings;
CREATE POLICY ledger_postings_select ON public.ledger_postings
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin', 'management'])
    OR (
      public.has_permission('reports.company')
      AND company_id IN (SELECT public.user_company_ids('read'))
      AND (
        NOT public.is_restricted_cashier()
        OR (
          location_id IS NOT NULL
          AND location_id IN (SELECT public.user_location_ids('read'))
        )
      )
    )
  );

COMMENT ON POLICY ledger_postings_select ON public.ledger_postings IS
  'Posted/report data requires reports.company in addition to company scope; entry-only users cannot query it.';
