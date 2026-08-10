-- Force RLS even for table owners; ship JWT acceptance harness with migrations.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'roles', 'user_roles', 'company_groups', 'companies',
    'user_company_access', 'locations', 'user_location_access', 'banks',
    'financial_years', 'accounting_periods', 'account_groups', 'parties',
    'party_aliases', 'salesmen', 'cost_centres', 'ledgers', 'party_company_links',
    'expense_heads', 'bank_accounts', 'closing_stock_entries', 'attachments',
    'consolidation_ledger_map', 'voucher_types', 'voucher_number_series',
    'intercompany_transfers', 'vouchers', 'voucher_lines', 'ledger_postings',
    'cash_verifications', 'bank_statement_imports', 'bank_statement_lines',
    'bank_reconciliations', 'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END;
$$;

-- Ensure mutating RPCs keep fixed search_path (defense in depth)
ALTER FUNCTION public.post_voucher(uuid) SET search_path = public;
ALTER FUNCTION public.approve_voucher(uuid) SET search_path = public;
ALTER FUNCTION public.reverse_voucher(uuid, date, text) SET search_path = public;
ALTER FUNCTION public.write_audit() SET search_path = public;
ALTER FUNCTION public.test_as_user(uuid) SET search_path = public;
