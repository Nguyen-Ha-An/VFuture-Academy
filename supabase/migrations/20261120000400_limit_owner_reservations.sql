-- One owner's outstanding native upload grants share a budget across buckets.
-- A grant covers a pending and a final copy. The native bucket limits are
-- 50 MiB for media/submissions and 10 MiB for notebooks.
alter table public.media_upload_limits
  add column owner_capacity_bytes bigint not null default 1073741824 check (owner_capacity_bytes > 0);
create index media_upload_unreleased_by_owner on public.media_upload_reservations(owner_id)
  where released_at is null;

-- The pending path and its owner survive finalization, which changes the path
-- on the notebook artifact. The signed grant can still be used after that.
create table public.notebook_upload_reservations (
  pending_path text primary key,
  ready_path text not null unique check (ready_path <> pending_path),
  owner_id uuid not null,
  retain_until timestamptz not null
);
create index notebook_upload_owner_expiry on public.notebook_upload_reservations(owner_id, retain_until);
create index notebook_upload_expiry on public.notebook_upload_reservations(retain_until);
alter table public.notebook_upload_reservations enable row level security;
revoke all on public.notebook_upload_reservations from public, anon, authenticated, service_role;
grant select on public.notebook_upload_reservations to service_role;

-- Existing artifacts can have been signed at the end of their two-hour
-- issuance window. Include both pending and already finalized artifacts.
insert into public.notebook_upload_reservations(pending_path, ready_path, owner_id, retain_until)
select case when status = 'pending' then storage_path
            else 'pending/' || owner_id || '/' || id || '/' || filename end,
       'ready/' || owner_id || '/' || id || '/' || filename, owner_id,
       created_at + interval '245 minutes'
from public.notebook_artifacts where created_at + interval '245 minutes' > now();

-- The Azure suffix additionally retains a path until its inventory hold has
-- been reconciled. Classic Storage exposes actual objects directly in SQL.
create function public.notebook_upload_hold_active(p_path text, p_ready text, p_until timestamptz)
returns boolean language sql stable security invoker set search_path = '' as $$
  select p_until > now();
$$;

-- Classic Storage's original media quota already includes existing objects and
-- media reservations. Include outstanding notebook grants on either kind of
-- admission. Subtract bytes already present at each reservation's own paths.
create function public.check_notebook_site_capacity(p_new_media_size bigint, p_notebook_path text)
returns void language plpgsql security invoker set search_path = '' as $$
declare cap bigint; used numeric; held numeric;
begin
  if p_notebook_path is null and not exists (
    select 1 from public.notebook_upload_reservations where retain_until > now()
  ) then return; end if;
  select capacity_bytes into cap from public.media_upload_limits where singleton;
  if cap is null then raise exception 'UPLOAD_CAPACITY'; end if;
  select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$'
    then (metadata->>'size')::numeric else cap end), 0) into used from storage.objects;
  with reservations(bucket, pending_path, ready_path, bytes) as (
    select bucket, pending_path, ready_path, 2 * size_bytes from public.media_upload_reservations
      where released_at is null
    union all
    select 'notebooks', pending_path, ready_path, 20971520 from public.notebook_upload_reservations
      where retain_until > now()
  )
  select coalesce(sum(greatest(r.bytes - coalesce((
    select sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::numeric else cap end)
    from storage.objects o where o.bucket_id = r.bucket and o.name in (r.pending_path, r.ready_path)
  ), 0), 0)), 0) into held from reservations r;
  -- A new notebook already has its ledger entry in this transaction. A media
  -- row is admitted by a BEFORE INSERT trigger and is still additional.
  if used + held + coalesce(2 * p_new_media_size, 0) > cap then raise exception 'UPLOAD_CAPACITY'; end if;
end $$;

-- Both inserts and the existing media lifecycle use this transaction lock.
-- The media reserve RPC handles a replay before INSERT, so an existing grant
-- never competes for a second allocation, even if a limit was lowered.
create function public.admit_owner_upload() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cap bigint; media_holds bigint; notebook_holds bigint; new_media_size bigint; notebook_path text;
begin
  perform pg_advisory_xact_lock(817004007);
  select owner_capacity_bytes into cap from public.media_upload_limits where singleton;
  if cap is null then raise exception 'UPLOAD_CAPACITY'; end if;
  delete from public.notebook_upload_reservations
    where owner_id = new.owner_id and not public.notebook_upload_hold_active(pending_path, ready_path, retain_until);
  select count(*) into media_holds from public.media_upload_reservations
    where owner_id = new.owner_id and released_at is null;
  select count(*) into notebook_holds from public.notebook_upload_reservations where owner_id = new.owner_id;
  if tg_table_name = 'media_upload_reservations' then
    media_holds := media_holds + 1;
    new_media_size := new.size_bytes;
  else
    notebook_holds := notebook_holds + 1;
  end if;
  if media_holds * 104857600 + notebook_holds * 20971520 > cap then
    raise exception 'UPLOAD_OWNER_CAPACITY';
  end if;
  if tg_table_name = 'notebook_artifacts' then
    notebook_path := new.storage_path;
    insert into public.notebook_upload_reservations(pending_path, ready_path, owner_id, retain_until)
    values(notebook_path, 'ready/' || new.owner_id || '/' || new.id || '/' || new.filename,
           new.owner_id, now() + interval '125 minutes');
  end if;
  perform public.check_notebook_site_capacity(new_media_size, notebook_path);
  return new;
end $$;
create trigger admit_owner_media_upload before insert on public.media_upload_reservations
  for each row execute function public.admit_owner_upload();
create trigger admit_owner_notebook_upload after insert on public.notebook_artifacts
  for each row when (new.status = 'pending') execute function public.admit_owner_upload();

-- Record the provider's actual expiry before handing its URL to the browser.
-- Reissuing the same pending path may extend its hold, never allocate it twice.
create function public.confirm_notebook_upload_expiry(p_owner uuid, p_path text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(817004007);
  if p_expires_at is null or p_expires_at <= now() then raise exception 'INVALID_UPLOAD'; end if;
  update public.notebook_upload_reservations
    set retain_until = greatest(retain_until, p_expires_at + interval '5 minutes')
    where pending_path = p_path and owner_id = p_owner and public.notebook_upload_hold_active(pending_path, ready_path, retain_until);
  if not found then raise exception 'UPLOAD_EXPIRED'; end if;
end $$;

revoke all on function public.notebook_upload_hold_active(text,text,timestamptz),
  public.check_notebook_site_capacity(bigint,text), public.admit_owner_upload(),
  public.confirm_notebook_upload_expiry(uuid,text,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.confirm_notebook_upload_expiry(uuid,text,timestamptz) to service_role;
