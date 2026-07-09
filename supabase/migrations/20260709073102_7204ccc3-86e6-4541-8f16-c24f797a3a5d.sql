-- Lock down SECURITY DEFINER trigger functions so signed-in users cannot call them directly.
-- Triggers execute as the table owner regardless of EXECUTE grants, so revoking is safe.
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_bootstrap_admin() FROM PUBLIC, anon, authenticated;

-- has_role is intentionally callable by signed-in users (used inside RLS policies).
-- Keep EXECUTE for authenticated, but remove it from anon and PUBLIC.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;