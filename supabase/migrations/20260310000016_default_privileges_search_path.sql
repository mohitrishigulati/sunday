-- Default privileges + search_path enforcement for SECURITY DEFINER
-- Pin first, then assert — never assert before pinning (that broke combined runs).

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Also cover supabase_admin when present (hosted Supabase migrations).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    EXECUTE $q$
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
        REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC
    $q$;
    EXECUTE $q$
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
        REVOKE EXECUTE ON FUNCTIONS FROM anon
    $q$;
  END IF;
END;
$$;

-- 1) Pin search_path on EVERY public SECURITY DEFINER function first
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
  END LOOP;
END;
$$;

-- 2) Fail if any SECURITY DEFINER remains executable by authenticated without pinned search_path
DO $$
DECLARE
  r record;
  v_bad text := '';
BEGIN
  FOR r IN
    SELECT
      p.proname AS func_name,
      pg_get_function_identity_arguments(p.oid) AS args,
      p.proconfig AS config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    IF r.config IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM unnest(COALESCE(r.config, ARRAY[]::text[])) cfg
         WHERE cfg LIKE 'search_path=%'
       )
    THEN
      v_bad := v_bad || format('%s(%s); ', r.func_name, r.args);
    END IF;
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION
      'SECURITY DEFINER executable by authenticated without pinned search_path: %',
      v_bad;
  END IF;
END;
$$;
