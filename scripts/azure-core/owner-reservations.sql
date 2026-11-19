-- Apply after the portable per-owner migration and the retained Storage setup.
-- Older tokens can outlive the artifact's original signing window. Recover
-- their owners from the artifact, including one already moved to its ready path.
insert into public.notebook_upload_reservations(pending_path, ready_path, owner_id, retain_until)
select o.name, 'ready/' || a.owner_id || '/' || a.id || '/' || a.filename, a.owner_id, o.retain_until
from academy_private.storage_objects o
join public.notebook_artifacts a on a.storage_path = o.name
  or (a.status = 'ready' and 'pending/' || a.owner_id || '/' || a.id || '/' || a.filename = o.name)
where o.bucket_id = 'notebooks' and o.hold_kind = 'signed'
on conflict (pending_path) do update
  set retain_until = greatest(public.notebook_upload_reservations.retain_until, excluded.retain_until);
do $$ begin
  if exists (
    select 1 from academy_private.storage_objects o where o.bucket_id = 'notebooks' and o.hold_kind = 'signed'
      and not exists (select 1 from public.notebook_upload_reservations r where r.pending_path = o.name)
  ) then raise exception 'Unattributed notebook upload hold; reconcile retained Storage before migration'; end if;
end $$;

-- Split the old combined allowance into one native bucket maximum per actual
-- path. Both stay quarantined and can be individually verified by the sweep.
insert into academy_private.storage_objects as existing(bucket_id, name, metadata, retain_until, hold_kind)
select 'notebooks', r.ready_path,
  jsonb_build_object('size', 10485760, 'mimetype', o.metadata->>'mimetype', 'reserved', true), o.retain_until, 'signed'
from public.notebook_upload_reservations r join academy_private.storage_objects o
  on o.bucket_id = 'notebooks' and o.name = r.pending_path and o.hold_kind = 'signed'
on conflict (bucket_id, name) do update set
  metadata = existing.metadata || jsonb_build_object('size', greatest((existing.metadata->>'size')::numeric, 10485760), 'reserved', true),
  retain_until = greatest(existing.retain_until, excluded.retain_until), hold_kind = 'signed';
update academy_private.storage_objects o set metadata = o.metadata || jsonb_build_object(
  'size', case when o.metadata->'reserved' = 'true'::jsonb and (o.metadata->>'size')::numeric = 20971520
    then 10485760 else greatest((o.metadata->>'size')::numeric, 10485760) end, 'reserved', true)
from public.notebook_upload_reservations r where o.bucket_id = 'notebooks' and o.name = r.pending_path and o.hold_kind = 'signed';

create or replace function public.notebook_upload_hold_active(p_path text, p_ready text, p_until timestamptz)
returns boolean language sql stable security invoker set search_path = '' as $$
  select p_until > now() or exists (
    select 1 from academy_private.storage_objects where bucket_id = 'notebooks' and name in (p_path, p_ready) and hold_kind = 'signed'
  );
$$;

create or replace function public.academy_storage_reserve_signed(p_bucket text, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare n public.notebook_artifacts%rowtype; ready text; reserved_copies int;
  cap bigint; used numeric; held numeric; prior_bytes numeric;
begin
  perform pg_advisory_xact_lock(817004007);
  if exists (
    select 1 from public.media_upload_reservations where bucket = p_bucket and pending_path = p_path
      and state = 'reserved' and expires_at > now()
  ) then return; end if;
  select * into n from public.notebook_artifacts where p_bucket = 'notebooks'
    and storage_path = p_path and status = 'pending' for update;
  if not found or n.created_at + interval '2 hours' <= now() then raise exception 'UPLOAD_NOT_FOUND'; end if;
  -- The artifact insert held the owner's share before this path could be signed.
  -- Renew the pre-issuance horizon even if a provider request subsequently fails.
  update public.notebook_upload_reservations set retain_until = greatest(retain_until, now() + interval '125 minutes')
    where pending_path = p_path and owner_id = n.owner_id and public.notebook_upload_hold_active(pending_path, ready_path, retain_until)
    returning ready_path into ready;
  if not found then raise exception 'UPLOAD_EXPIRED'; end if;
  if not exists (select 1 from academy_private.storage_inventory_receipts) then raise exception 'UPLOAD_CAPACITY'; end if;
  select capacity_bytes into cap from public.media_upload_limits where singleton;
  if cap is null then raise exception 'UPLOAD_CAPACITY'; end if;
  select count(*) filter (where hold_kind = 'signed'),
         coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then least((metadata->>'size')::numeric, 10485760) else 0 end), 0)
    into reserved_copies, prior_bytes from academy_private.storage_objects where bucket_id = p_bucket and name in (p_path, ready);
  if reserved_copies = 2 then
    update academy_private.storage_objects set retain_until = greatest(retain_until, now() + interval '125 minutes'),
        observed_at = clock_timestamp() where bucket_id = p_bucket and name in (p_path, ready);
    return;
  end if;
  select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else cap end), 0)
    into used from academy_private.storage_objects;
  select count(*) * 104857600 into held from public.media_upload_reservations where released_at is null;
  if used + held + 20971520 - prior_bytes > cap then raise exception 'UPLOAD_CAPACITY'; end if;
  insert into academy_private.storage_objects as existing(bucket_id, name, metadata, retain_until, hold_kind)
    select p_bucket, path, jsonb_build_object('size', 10485760, 'mimetype', n.mime, 'reserved', true),
           now() + interval '125 minutes', 'signed' from unnest(array[p_path, ready]) as paths(path)
    on conflict (bucket_id, name) do update set
      metadata = existing.metadata || jsonb_build_object('size', greatest((existing.metadata->>'size')::numeric, 10485760), 'reserved', true),
      hold_kind = 'signed', retain_until = greatest(existing.retain_until, excluded.retain_until), observed_at = clock_timestamp();
end $$;

-- Only the bound ready file may use its preallocated copy. Other writes keep
-- the existing verified-inventory admission, including direct media finalization.
alter function public.academy_storage_begin_write(text,text,bigint,text) set schema academy_private;
revoke all on function academy_private.academy_storage_begin_write(text,text,bigint,text) from public, anon, authenticated, service_role;
create function public.academy_storage_begin_write(p_bucket text, p_path text, p_size bigint, p_mime text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(817004007);
  if p_bucket = 'notebooks' and exists (
    select 1 from academy_private.storage_objects where bucket_id = p_bucket and name = p_path and hold_kind = 'signed'
  ) and not exists (
    select 1 from public.notebook_upload_reservations r join public.notebook_artifacts a
      on a.owner_id = r.owner_id and a.storage_path in (r.pending_path, r.ready_path)
    where r.ready_path = p_path and a.mime = p_mime and p_size between 1 and 10485760
      and case when a.purpose = 'dataset' then p_size = a.size_bytes else p_size <= 5242880 end
  ) then raise exception 'INVALID_UPLOAD'; end if;
  perform academy_private.academy_storage_begin_write(p_bucket, p_path, p_size, p_mime);
end $$;
revoke all on function public.academy_storage_begin_write(text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.academy_storage_begin_write(text,text,bigint,text) to service_role;

create or replace function public.academy_storage_confirm_signed(p_bucket text, p_path text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.notebook_upload_reservations%rowtype; copies int;
begin
  perform pg_advisory_xact_lock(817004007);
  if p_expires_at is null or p_expires_at <= now() then raise exception 'INVALID_UPLOAD'; end if;
  update public.media_upload_reservations set retain_until = greatest(retain_until, p_expires_at + interval '5 minutes')
    where bucket = p_bucket and pending_path = p_path and state = 'reserved' and expires_at > now();
  if found then return; end if;
  select * into r from public.notebook_upload_reservations where p_bucket = 'notebooks' and pending_path = p_path;
  if not found then raise exception 'UPLOAD_NOT_FOUND'; end if;
  perform public.confirm_notebook_upload_expiry(r.owner_id, p_path, p_expires_at);
  update academy_private.storage_objects set retain_until = greatest(retain_until, p_expires_at + interval '5 minutes')
    where bucket_id = p_bucket and name in (r.pending_path, r.ready_path) and hold_kind = 'signed';
  get diagnostics copies = row_count;
  if copies <> 2 then raise exception 'UPLOAD_NOT_FOUND'; end if;
end $$;

-- Reserve the verified inventory in the transaction that creates the notebook
-- and charges its owner. Failure rolls back all three. The retained Storage
-- adapter rechecks the same pending path immediately before issuing its URL.
create or replace function public.check_notebook_site_capacity(p_new_media_size bigint, p_notebook_path text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_notebook_path is not null then
    perform public.academy_storage_reserve_signed('notebooks', p_notebook_path);
  end if;
end $$;

-- Preserve each copy's native allowance through its quarantine. Reconciliation
-- clears hold_kind after expiry and restores the exact verified size or absence.
create function academy_private.retain_notebook_upload_bytes() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.metadata->>'size' ~ '^[0-9]+$' and (new.metadata->>'size')::numeric < 10485760 then
    new.metadata := new.metadata || jsonb_build_object('size', 10485760, 'reserved', true);
  end if;
  return new;
end $$;
revoke all on function academy_private.retain_notebook_upload_bytes() from public, anon, authenticated, service_role;
create trigger retain_notebook_upload_bytes before insert or update of metadata, hold_kind on academy_private.storage_objects
  for each row when (new.bucket_id = 'notebooks' and new.hold_kind = 'signed')
  execute function academy_private.retain_notebook_upload_bytes();
