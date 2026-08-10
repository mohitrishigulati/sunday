-- Atomic, admin-only role assignment.
-- The previous client-side delete-all/insert flow could delete the caller's
-- admin role before RLS evaluated the reinsertion, permanently locking them out.

CREATE OR REPLACE FUNCTION public.admin_set_user_roles(
  p_user_id uuid,
  p_role_codes text[]
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_codes text[];
  v_result text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Only an admin can manage users and access';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT code ORDER BY code), '{}'::text[])
  INTO v_codes
  FROM unnest(COALESCE(p_role_codes, '{}'::text[])) AS requested(code);

  IF EXISTS (
    SELECT 1
    FROM unnest(v_codes) AS requested(code)
    WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.code = requested.code)
  ) THEN
    RAISE EXCEPTION 'Unknown role requested';
  END IF;

  IF p_user_id = auth.uid() AND NOT ('admin' = ANY(v_codes)) THEN
    RAISE EXCEPTION 'You cannot remove your own admin role';
  END IF;

  -- Insert first so the caller's admin grant is never absent while policies run.
  INSERT INTO public.user_roles (user_id, role_id)
  SELECT p_user_id, r.id
  FROM public.roles r
  WHERE r.code = ANY(v_codes)
  ON CONFLICT DO NOTHING;

  DELETE FROM public.user_roles ur
  USING public.roles r
  WHERE ur.user_id = p_user_id
    AND r.id = ur.role_id
    AND NOT (r.code = ANY(v_codes));

  SELECT COALESCE(array_agg(r.code ORDER BY r.code), '{}'::text[])
  INTO v_result
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = p_user_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_roles(uuid, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_roles(uuid, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_roles(uuid, text[]) TO authenticated;

COMMENT ON FUNCTION public.admin_set_user_roles(uuid, text[]) IS
  'Atomically replaces a user role set. Admin-only and prevents self-admin lockout.';
