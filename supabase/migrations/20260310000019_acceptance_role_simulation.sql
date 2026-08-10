-- Acceptance helpers must not SET ROLE from a SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION public.test_as_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.test_as_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_as_user(uuid)
  TO postgres, service_role, authenticated;
