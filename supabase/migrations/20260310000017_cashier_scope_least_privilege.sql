-- Cashier location scoping: least privilege when roles are combined.
CREATE OR REPLACE FUNCTION public.is_restricted_cashier()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_has_role(ARRAY['cashier'])
    AND NOT public.user_has_role(ARRAY['admin']);
$$;

GRANT EXECUTE ON FUNCTION public.is_restricted_cashier() TO authenticated;
