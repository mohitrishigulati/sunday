-- Keep audit logging valid for tables with composite keys and no `id` column.
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
    v_record_id := COALESCE(
      NULLIF(v_old ->> 'id', '')::uuid,
      NULLIF(v_old ->> 'user_id', '')::uuid,
      md5(v_old::text)::uuid
    );
    v_company_id := NULLIF(v_old ->> 'company_id', '')::uuid;
  ELSE
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
    v_new := to_jsonb(NEW);
    v_record_id := COALESCE(
      NULLIF(v_new ->> 'id', '')::uuid,
      NULLIF(v_new ->> 'user_id', '')::uuid,
      md5(v_new::text)::uuid
    );
    v_company_id := NULLIF(v_new ->> 'company_id', '')::uuid;
  END IF;

  INSERT INTO public.audit_log
    (actor_id, company_id, table_name, record_id, action, old_row, new_row)
  VALUES
    (auth.uid(), v_company_id, TG_TABLE_NAME, v_record_id, v_action, v_old, v_new);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_audit() FROM anon, authenticated;
