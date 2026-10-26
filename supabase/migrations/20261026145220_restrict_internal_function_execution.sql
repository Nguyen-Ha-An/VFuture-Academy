-- Hosted Supabase defaults grant EXECUTE directly to anon/authenticated in
-- addition to PostgreSQL's PUBLIC grant. Historical PUBLIC-only revokes left
-- trusted progress mutations and internal helpers callable through the API.
-- Preserve the immutable ledger and repair those explicit role grants here.

revoke all on function public.learner_mark_viewed(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.learner_complete_course(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.learner_claim_completion_effect(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.learner_mark_viewed(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.learner_complete_course(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.learner_claim_completion_effect(uuid, text, timestamptz) to service_role;

-- These functions execute internally as triggers or trusted trigger helpers.
-- Revoking direct API execution does not remove existing trigger bindings.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.prevent_self_branch_change() from public, anon, authenticated;
revoke all on function public.initialize_user_account() from public, anon, authenticated;
revoke all on function public.validate_role_definition() from public, anon, authenticated;
revoke all on function public.validate_role_assignment() from public, anon, authenticated;
revoke all on function public.lock_and_assert_central_admin_remains(uuid) from public, anon, authenticated;
revoke all on function public.protect_final_admin_assignment() from public, anon, authenticated;
revoke all on function public.protect_final_admin_account() from public, anon, authenticated;
revoke all on function public.protect_built_in_role_definition() from public, anon, authenticated;
revoke all on function public.stamp_enrollment_branch_history() from public, anon, authenticated;
revoke all on function public.stamp_enrollment_derived_branch_history() from public, anon, authenticated;
revoke all on function public.stamp_analytics_branch_history() from public, anon, authenticated;
revoke all on function public.enforce_active_account_write() from public, anon, authenticated;
revoke all on function public.prevent_legacy_user_role_write() from public, anon, authenticated;

-- Authenticated RLS policies intentionally call these two identity-bound
-- read helpers. Keep that contract while removing anonymous API execution.
revoke all on function public.can_access_course(text) from public, anon;
revoke all on function public.current_branch_id() from public, anon;
grant execute on function public.can_access_course(text) to authenticated;
grant execute on function public.current_branch_id() to authenticated;
