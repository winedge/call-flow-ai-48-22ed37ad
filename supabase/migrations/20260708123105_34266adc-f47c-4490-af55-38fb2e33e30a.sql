
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_bootstrap_admin() FROM PUBLIC, anon, authenticated;
