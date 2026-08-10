-- Phase 1: RLS helpers and policies
CREATE OR REPLACE FUNCTION public.user_has_role(p_codes text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.code = ANY (p_codes)
  );
$$;

CREATE OR REPLACE FUNCTION public.user_company_ids(p_capability text DEFAULT 'read')
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT uca.company_id
  FROM public.user_company_access uca
  JOIN public.profiles p ON p.id = uca.user_id
  WHERE uca.user_id = auth.uid()
    AND p.is_active
    AND (
      (p_capability = 'read' AND uca.can_read)
      OR (p_capability = 'write' AND uca.can_write)
      OR (p_capability = 'approve' AND uca.can_approve)
      OR (p_capability = 'manage' AND uca.can_manage)
    );
$$;

CREATE OR REPLACE FUNCTION public.user_location_ids(p_capability text DEFAULT 'read')
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ula.location_id
  FROM public.user_location_access ula
  JOIN public.profiles p ON p.id = ula.user_id
  WHERE ula.user_id = auth.uid()
    AND p.is_active
    AND (
      (p_capability = 'read' AND ula.can_read)
      OR (p_capability = 'write' AND ula.can_write)
    );
$$;

CREATE OR REPLACE FUNCTION public.user_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT c.group_id
  FROM public.companies c
  WHERE c.id IN (SELECT public.user_company_ids('read'));
$$;

CREATE OR REPLACE FUNCTION public.has_permission(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT bool_or(COALESCE((r.permissions ->> p_key)::boolean, false))
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
    ),
    false
  );
$$;

-- Fix audit writer to avoid missing-column errors
CREATE OR REPLACE FUNCTION public.write_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_record_id uuid;
  v_action text;
  v_old jsonb;
  v_new jsonb;
BEGIN
  v_action := TG_OP;
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_record_id := (v_old ->> 'id')::uuid;
    v_company_id := NULLIF(v_old ->> 'company_id', '')::uuid;
  ELSE
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
    v_new := to_jsonb(NEW);
    v_record_id := (v_new ->> 'id')::uuid;
    v_company_id := NULLIF(v_new ->> 'company_id', '')::uuid;
  END IF;

  INSERT INTO public.audit_log (actor_id, company_id, table_name, record_id, action, old_row, new_row)
  VALUES (auth.uid(), v_company_id, TG_TABLE_NAME, v_record_id, v_action, v_old, v_new);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_company_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_location_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salesmen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_company_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closing_stock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consolidation_ledger_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_number_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intercompany_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY profiles_select_self_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.user_has_role(ARRAY['admin']));

CREATE POLICY profiles_update_self_or_admin ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (id = auth.uid() OR public.user_has_role(ARRAY['admin']));

-- Roles readable to authenticated
CREATE POLICY roles_select ON public.roles
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY user_roles_select ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.user_has_role(ARRAY['admin']));

CREATE POLICY user_roles_admin_write ON public.user_roles
  FOR ALL TO authenticated
  USING (public.user_has_role(ARRAY['admin']))
  WITH CHECK (public.user_has_role(ARRAY['admin']));

-- Groups / companies
CREATE POLICY company_groups_select ON public.company_groups
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.user_group_ids()) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY company_groups_admin_write ON public.company_groups
  FOR ALL TO authenticated
  USING (public.user_has_role(ARRAY['admin']))
  WITH CHECK (public.user_has_role(ARRAY['admin']));

CREATE POLICY companies_select ON public.companies
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY companies_manage ON public.companies
  FOR ALL TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR id IN (SELECT public.user_company_ids('manage'))
  )
  WITH CHECK (
    public.user_has_role(ARRAY['admin'])
    OR id IN (SELECT public.user_company_ids('manage'))
  );

CREATE POLICY user_company_access_select ON public.user_company_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.user_has_role(ARRAY['admin']));

CREATE POLICY user_company_access_admin ON public.user_company_access
  FOR ALL TO authenticated
  USING (public.user_has_role(ARRAY['admin']))
  WITH CHECK (public.user_has_role(ARRAY['admin']));

-- Locations with cashier scoping
CREATE POLICY locations_select ON public.locations
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR (
      company_id IN (SELECT public.user_company_ids('read'))
      AND (
        NOT public.user_has_role(ARRAY['cashier'])
        OR public.user_has_role(ARRAY['admin', 'accountant', 'approver', 'management'])
        OR id IN (SELECT public.user_location_ids('read'))
      )
    )
  );

CREATE POLICY locations_manage ON public.locations
  FOR ALL TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR company_id IN (SELECT public.user_company_ids('manage'))
  )
  WITH CHECK (
    public.user_has_role(ARRAY['admin'])
    OR company_id IN (SELECT public.user_company_ids('manage'))
  );

CREATE POLICY user_location_access_select ON public.user_location_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.user_has_role(ARRAY['admin']));

CREATE POLICY user_location_access_admin ON public.user_location_access
  FOR ALL TO authenticated
  USING (public.user_has_role(ARRAY['admin']))
  WITH CHECK (public.user_has_role(ARRAY['admin']));

CREATE POLICY banks_select ON public.banks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY banks_admin ON public.banks
  FOR ALL TO authenticated
  USING (public.user_has_role(ARRAY['admin']))
  WITH CHECK (public.user_has_role(ARRAY['admin']));

-- Generic company-scoped policy helper pattern applied per table
CREATE POLICY financial_years_select ON public.financial_years
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY financial_years_write ON public.financial_years
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY accounting_periods_select ON public.accounting_periods
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY accounting_periods_write ON public.accounting_periods
  FOR ALL TO authenticated
  USING (
    public.has_permission('periods.lock')
    OR company_id IN (SELECT public.user_company_ids('manage'))
    OR public.user_has_role(ARRAY['admin'])
  )
  WITH CHECK (
    public.has_permission('periods.lock')
    OR company_id IN (SELECT public.user_company_ids('manage'))
    OR public.user_has_role(ARRAY['admin'])
  );

CREATE POLICY account_groups_select ON public.account_groups
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL
    OR company_id IN (SELECT public.user_company_ids('read'))
    OR public.user_has_role(ARRAY['admin'])
  );

CREATE POLICY account_groups_write ON public.account_groups
  FOR ALL TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids('manage'))
    OR public.user_has_role(ARRAY['admin'])
  )
  WITH CHECK (
    company_id IN (SELECT public.user_company_ids('manage'))
    OR public.user_has_role(ARRAY['admin'])
  );

CREATE POLICY parties_select ON public.parties
  FOR SELECT TO authenticated
  USING (group_id IN (SELECT public.user_group_ids()) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY parties_write ON public.parties
  FOR ALL TO authenticated
  USING (public.has_permission('masters.write') OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (
    (group_id IN (SELECT public.user_group_ids()) AND public.has_permission('masters.write'))
    OR public.user_has_role(ARRAY['admin'])
  );

CREATE POLICY party_aliases_select ON public.party_aliases
  FOR SELECT TO authenticated
  USING (
    party_id IN (
      SELECT id FROM public.parties WHERE group_id IN (SELECT public.user_group_ids())
    )
    OR public.user_has_role(ARRAY['admin'])
  );

CREATE POLICY party_aliases_write ON public.party_aliases
  FOR ALL TO authenticated
  USING (public.has_permission('masters.write') OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (public.has_permission('masters.write') OR public.user_has_role(ARRAY['admin']));

CREATE POLICY salesmen_select ON public.salesmen
  FOR SELECT TO authenticated
  USING (group_id IN (SELECT public.user_group_ids()) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY salesmen_write ON public.salesmen
  FOR ALL TO authenticated
  USING (public.has_permission('masters.write') OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (public.has_permission('masters.write') OR public.user_has_role(ARRAY['admin']));

CREATE POLICY cost_centres_select ON public.cost_centres
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY cost_centres_write ON public.cost_centres
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY ledgers_select ON public.ledgers
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY ledgers_write ON public.ledgers
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY party_company_links_select ON public.party_company_links
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY party_company_links_write ON public.party_company_links
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY expense_heads_select ON public.expense_heads
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY expense_heads_write ON public.expense_heads
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY bank_accounts_select ON public.bank_accounts
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY bank_accounts_write ON public.bank_accounts
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY closing_stock_select ON public.closing_stock_entries
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY closing_stock_write ON public.closing_stock_entries
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY attachments_select ON public.attachments
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY attachments_write ON public.attachments
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY consol_map_select ON public.consolidation_ledger_map
  FOR SELECT TO authenticated
  USING (
    public.has_permission('reports.consolidated')
    OR public.user_has_role(ARRAY['admin', 'management'])
  );

CREATE POLICY consol_map_write ON public.consolidation_ledger_map
  FOR ALL TO authenticated
  USING (public.user_has_role(ARRAY['admin']))
  WITH CHECK (public.user_has_role(ARRAY['admin']));

CREATE POLICY voucher_types_select ON public.voucher_types
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL
    OR company_id IN (SELECT public.user_company_ids('read'))
    OR public.user_has_role(ARRAY['admin'])
  );

CREATE POLICY voucher_types_write ON public.voucher_types
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (company_id IN (SELECT public.user_company_ids('manage')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY voucher_number_series_select ON public.voucher_number_series
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

-- Series mutations only via SECURITY DEFINER posting function
CREATE POLICY voucher_number_series_no_client_write ON public.voucher_number_series
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY intercompany_transfers_select ON public.intercompany_transfers
  FOR SELECT TO authenticated
  USING (
    from_company_id IN (SELECT public.user_company_ids('read'))
    OR to_company_id IN (SELECT public.user_company_ids('read'))
    OR public.user_has_role(ARRAY['admin', 'management'])
  );

CREATE POLICY intercompany_transfers_write ON public.intercompany_transfers
  FOR ALL TO authenticated
  USING (from_company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']))
  WITH CHECK (from_company_id IN (SELECT public.user_company_ids('write')) OR public.user_has_role(ARRAY['admin']));

-- Vouchers: company + location for cash
CREATE POLICY vouchers_select ON public.vouchers
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin'])
    OR (
      company_id IN (SELECT public.user_company_ids('read'))
      AND (
        location_id IS NULL
        OR location_id IN (SELECT public.user_location_ids('read'))
        OR NOT public.user_has_role(ARRAY['cashier'])
        OR public.user_has_role(ARRAY['admin', 'accountant', 'approver', 'management', 'data_entry'])
      )
    )
  );

CREATE POLICY vouchers_insert ON public.vouchers
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id IN (SELECT public.user_company_ids('write'))
    AND (
      location_id IS NULL
      OR location_id IN (SELECT public.user_location_ids('write'))
      OR NOT public.has_permission('cash.write')
      OR public.user_has_role(ARRAY['admin', 'accountant', 'approver', 'data_entry'])
    )
    AND public.has_permission('vouchers.draft')
  );

CREATE POLICY vouchers_update ON public.vouchers
  FOR UPDATE TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids('write'))
    AND status IN ('draft', 'submitted', 'rejected')
  )
  WITH CHECK (company_id IN (SELECT public.user_company_ids('write')));

CREATE POLICY vouchers_delete ON public.vouchers
  FOR DELETE TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids('write'))
    AND status IN ('draft', 'rejected')
  );

CREATE POLICY voucher_lines_select ON public.voucher_lines
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids('read'))
    OR public.user_has_role(ARRAY['admin'])
  );

CREATE POLICY voucher_lines_write ON public.voucher_lines
  FOR ALL TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids('write'))
    AND EXISTS (
      SELECT 1 FROM public.vouchers v
      WHERE v.id = voucher_id AND v.status IN ('draft', 'submitted', 'rejected')
    )
  )
  WITH CHECK (company_id IN (SELECT public.user_company_ids('write')));

CREATE POLICY ledger_postings_select ON public.ledger_postings
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids('read'))
    OR public.user_has_role(ARRAY['admin', 'management'])
  );

-- No direct client writes to ledger_postings
CREATE POLICY ledger_postings_no_client_insert ON public.ledger_postings
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY cash_verifications_select ON public.cash_verifications
  FOR SELECT TO authenticated
  USING (
    (
      company_id IN (SELECT public.user_company_ids('read'))
      AND location_id IN (SELECT public.user_location_ids('read'))
    )
    OR (
      company_id IN (SELECT public.user_company_ids('read'))
      AND NOT public.user_has_role(ARRAY['cashier'])
    )
    OR public.user_has_role(ARRAY['admin'])
  );

CREATE POLICY cash_verifications_write ON public.cash_verifications
  FOR ALL TO authenticated
  USING (
    location_id IN (SELECT public.user_location_ids('write'))
    OR company_id IN (SELECT public.user_company_ids('write'))
  )
  WITH CHECK (
    location_id IN (SELECT public.user_location_ids('write'))
    OR company_id IN (SELECT public.user_company_ids('write'))
  );

CREATE POLICY bank_imports_select ON public.bank_statement_imports
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids('read')) OR public.user_has_role(ARRAY['admin']));

CREATE POLICY bank_imports_write ON public.bank_statement_imports
  FOR ALL TO authenticated
  USING (
    (company_id IN (SELECT public.user_company_ids('write')) AND public.has_permission('bank.import'))
    OR public.user_has_role(ARRAY['admin'])
  )
  WITH CHECK (
    (company_id IN (SELECT public.user_company_ids('write')) AND public.has_permission('bank.import'))
    OR public.user_has_role(ARRAY['admin'])
  );

CREATE POLICY bank_statement_lines_select ON public.bank_statement_lines
  FOR SELECT TO authenticated
  USING (
    bank_account_id IN (
      SELECT id FROM public.bank_accounts
      WHERE company_id IN (SELECT public.user_company_ids('read'))
    )
    OR public.user_has_role(ARRAY['admin'])
  );

CREATE POLICY bank_statement_lines_insert ON public.bank_statement_lines
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('bank.import') OR public.user_has_role(ARRAY['admin']));

CREATE POLICY bank_statement_lines_update_match ON public.bank_statement_lines
  FOR UPDATE TO authenticated
  USING (public.has_permission('bank.import') OR public.user_has_role(ARRAY['admin', 'accountant']))
  WITH CHECK (public.has_permission('bank.import') OR public.user_has_role(ARRAY['admin', 'accountant']));

CREATE POLICY bank_reconciliations_select ON public.bank_reconciliations
  FOR SELECT TO authenticated
  USING (
    bank_account_id IN (
      SELECT id FROM public.bank_accounts
      WHERE company_id IN (SELECT public.user_company_ids('read'))
    )
    OR public.user_has_role(ARRAY['admin'])
  );

CREATE POLICY bank_reconciliations_write ON public.bank_reconciliations
  FOR ALL TO authenticated
  USING (public.has_permission('bank.import') OR public.user_has_role(ARRAY['admin', 'accountant']))
  WITH CHECK (public.has_permission('bank.import') OR public.user_has_role(ARRAY['admin', 'accountant']));

-- Audit: select only; no client insert/update/delete
CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['admin', 'management'])
    OR (
      company_id IN (SELECT public.user_company_ids('read'))
      AND public.has_permission('reports.company')
    )
  );

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_voucher(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_voucher(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_balance(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_company_ids(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_location_ids(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_role(text[]) TO authenticated;
