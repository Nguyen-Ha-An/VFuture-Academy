-- Azure-only addition. A browser can retry the same verified recovery after a
-- lost RPC response without revoking sessions created by a subsequent sign-in.
create table if not exists academy_identity.recovery_revocations (
  attempt_hash text primary key check (attempt_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);
create index if not exists recovery_revocations_expiry on academy_identity.recovery_revocations(expires_at);
revoke all on academy_identity.recovery_revocations from public, anon, authenticated;

create or replace function public.academy_identity_revoke_recovered_sessions(
  p_issuer text, p_subject uuid, p_attempt_hash text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_issuer is null or p_issuer = '' or p_subject is null then
    raise invalid_parameter_value;
  end if;
  delete from academy_identity.recovery_revocations where expires_at <= now();
  insert into academy_identity.recovery_revocations (attempt_hash, expires_at)
    values (p_attempt_hash, now() + interval '15 minutes')
    on conflict (attempt_hash) do nothing;
  if found then
    delete from academy_identity.sessions s
    using academy_identity.mappings m
    where m.issuer = p_issuer and m.subject = p_subject and s.user_id = m.user_id;
  end if;
end; $$;

revoke all on function public.academy_identity_revoke_recovered_sessions(text,uuid,text) from public, anon, authenticated;
grant execute on function public.academy_identity_revoke_recovered_sessions(text,uuid,text) to service_role;
