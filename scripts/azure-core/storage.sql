create function public.academy_storage_observe(p_bucket text,p_path text,p_metadata jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(817004007);
  if p_metadata is null then
    delete from academy_private.storage_objects where bucket_id=p_bucket and name=p_path;
  else
    if p_metadata->>'size' is null or p_metadata->>'size' !~ '^[0-9]+$' or p_metadata->>'mimetype' is null then raise exception 'Invalid verified storage metadata'; end if;
    insert into academy_private.storage_objects(bucket_id,name,metadata) values(p_bucket,p_path,p_metadata)
    on conflict(bucket_id,name) do update set metadata=excluded.metadata,observed_at=now();
  end if;
end $$;
revoke all on function public.academy_storage_observe(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.academy_storage_observe(text,text,jsonb) to service_role;
create function public.academy_identity_get_user(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',id,'email',email,'user_metadata',raw_user_meta_data,'created_at',created_at,'aud','authenticated','app_metadata','{}'::jsonb) from academy_identity.users where id=p_id;
$$;
revoke all on function public.academy_identity_get_user(uuid) from public,anon,authenticated;
grant execute on function public.academy_identity_get_user(uuid) to service_role;

-- Notebook signed uploads need conservative byte holds until their native token
-- expires, even if a browser replays a token after the pending object was removed.
alter table academy_private.storage_objects add column retain_until timestamptz;
alter table academy_private.storage_objects add column hold_kind text check(hold_kind in ('signed','write'));
create or replace function public.academy_storage_observe(p_bucket text,p_path text,p_metadata jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(817004007);
  if p_metadata is null then
    delete from academy_private.storage_objects where bucket_id=p_bucket and name=p_path and (retain_until is null or retain_until<=now());
  else
    if p_metadata->>'size' is null or p_metadata->>'size' !~ '^[0-9]+$' or p_metadata->>'mimetype' is null then raise exception 'Invalid verified storage metadata'; end if;
    insert into academy_private.storage_objects(bucket_id,name,metadata) values(p_bucket,p_path,p_metadata)
    on conflict(bucket_id,name) do update set metadata=excluded.metadata,observed_at=now(),retain_until=case when academy_private.storage_objects.hold_kind='signed' then academy_private.storage_objects.retain_until else null end,hold_kind=case when academy_private.storage_objects.hold_kind='signed' then 'signed' else null end;
  end if;
end $$;
create function public.academy_storage_reserve_signed(p_bucket text,p_path text)
returns void language plpgsql security definer set search_path='' as $$
declare n public.notebook_artifacts%rowtype; used numeric; held numeric; cap bigint;
begin
  perform pg_advisory_xact_lock(817004007);
  if exists(select 1 from public.media_upload_reservations where bucket=p_bucket and pending_path=p_path and state='reserved' and expires_at>now()) then return; end if;
  select * into n from public.notebook_artifacts where p_bucket='notebooks' and storage_path=p_path and status='pending' for update;
  if not found or n.created_at+interval '2 hours'<=now() then raise exception 'UPLOAD_NOT_FOUND'; end if;
  if not exists(select 1 from academy_private.storage_inventory_receipts) then raise exception 'UPLOAD_CAPACITY'; end if;
  select capacity_bytes into cap from public.media_upload_limits where singleton;
  select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else cap end),0) into used from academy_private.storage_objects;
  select coalesce(sum(2*52428800),0) into held from public.media_upload_reservations where released_at is null;
  if cap is null or used+held+greatest(2*10485760-coalesce((select (metadata->>'size')::numeric from academy_private.storage_objects where bucket_id=p_bucket and name=p_path),0),0)>cap then raise exception 'UPLOAD_CAPACITY'; end if;
  insert into academy_private.storage_objects(bucket_id,name,metadata,retain_until,hold_kind)
    values(p_bucket,p_path,jsonb_build_object('size',2*10485760,'mimetype',n.mime,'reserved',true),now()+interval '125 minutes','signed')
    on conflict(bucket_id,name) do update set retain_until=greatest(academy_private.storage_objects.retain_until,excluded.retain_until);
end $$;
revoke all on function public.academy_storage_reserve_signed(text,text) from public,anon,authenticated;
grant execute on function public.academy_storage_reserve_signed(text,text) to service_role;

create function public.academy_storage_begin_write(p_bucket text,p_path text,p_size bigint,p_mime text)
returns void language plpgsql security definer set search_path='' as $$
declare cap bigint; used numeric; held numeric;
begin
  perform pg_advisory_xact_lock(817004007);
  if p_size is null or p_size<1 or p_mime is null or length(p_mime)=0 then raise exception 'INVALID_UPLOAD'; end if;
  if not exists(select 1 from academy_private.storage_inventory_receipts) then raise exception 'UPLOAD_CAPACITY'; end if;
  -- Immutable conflict recovery cannot increase the bytes on an existing path.
  if exists(select 1 from academy_private.storage_objects where bucket_id=p_bucket and name=p_path) then
    update academy_private.storage_objects set retain_until=now()+interval '15 minutes',observed_at=clock_timestamp()
      where bucket_id=p_bucket and name=p_path and hold_kind='write';
    return;
  end if;
  -- Direct-upload admission already holds both copies until the fenced cleanup.
  if exists(select 1 from public.media_upload_reservations where bucket=p_bucket and ready_path=p_path and state='finalizing' and lease_until>now() and size_bytes=p_size and mime=p_mime) then return; end if;
  select capacity_bytes into cap from public.media_upload_limits where singleton;
  select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else cap end),0) into used from academy_private.storage_objects;
  select coalesce(sum(2*52428800),0) into held from public.media_upload_reservations where released_at is null;
  if cap is null or used+held+p_size>cap then raise exception 'UPLOAD_CAPACITY'; end if;
  -- A write that dies before observation consumes a conservative hold until
  -- actual object absence is verified by cleanup/reconciliation.
  insert into academy_private.storage_objects(bucket_id,name,metadata,retain_until,hold_kind) values(p_bucket,p_path,jsonb_build_object('size',p_size,'mimetype',p_mime,'reserved',true),now()+interval '15 minutes','write');
end $$;
revoke all on function public.academy_storage_begin_write(text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.academy_storage_begin_write(text,text,bigint,text) to service_role;

create function public.academy_storage_confirm_signed(p_bucket text,p_path text,p_expires_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(817004007);
  if p_expires_at is null or p_expires_at<=now() then raise exception 'INVALID_UPLOAD'; end if;
  update public.media_upload_reservations set retain_until=greatest(retain_until,p_expires_at+interval '5 minutes')
    where bucket=p_bucket and pending_path=p_path and state='reserved' and expires_at>now();
  if found then return; end if;
  update academy_private.storage_objects set retain_until=greatest(retain_until,p_expires_at+interval '5 minutes') where bucket_id=p_bucket and name=p_path and retain_until is not null;
  if not found then raise exception 'UPLOAD_NOT_FOUND'; end if;
end $$;
revoke all on function public.academy_storage_confirm_signed(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.academy_storage_confirm_signed(text,text,timestamptz) to service_role;

create function public.academy_storage_expired_holds(p_limit int default 25)
returns table(bucket_id text,name text,observed_at timestamptz) language sql security definer set search_path='' as $$
  select bucket_id,name,observed_at from academy_private.storage_objects where retain_until<=now()
  order by retain_until,bucket_id,name limit greatest(0,least(p_limit,100));
$$;
create function public.academy_storage_reconcile_hold(p_bucket text,p_path text,p_observed_at timestamptz,p_metadata jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(817004007);
  perform 1 from academy_private.storage_objects where bucket_id=p_bucket and name=p_path
    and observed_at=p_observed_at and retain_until<=now() for update;
  if not found then return false; end if;
  if p_metadata is null then
    delete from academy_private.storage_objects where bucket_id=p_bucket and name=p_path;
  else
    if p_metadata->>'size' is null or p_metadata->>'size' !~ '^[0-9]+$' or p_metadata->>'mimetype' is null then raise exception 'Invalid verified storage metadata'; end if;
    update academy_private.storage_objects set metadata=p_metadata,observed_at=now(),retain_until=null,hold_kind=null where bucket_id=p_bucket and name=p_path;
  end if;
  return true;
end $$;
revoke all on function public.academy_storage_expired_holds(int),public.academy_storage_reconcile_hold(text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.academy_storage_expired_holds(int),public.academy_storage_reconcile_hold(text,text,timestamptz,jsonb) to service_role;
