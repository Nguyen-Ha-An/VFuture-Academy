-- Learner direct-upload admission. Only the application service role can use
-- these functions. Storage's own schema is read, never altered.
create table public.media_upload_limits (
  singleton boolean primary key default true check (singleton),
  capacity_bytes bigint not null default 10737418240 check (capacity_bytes > 0)
);
insert into public.media_upload_limits(singleton) values(true);
create table public.media_upload_reservations (
  id uuid primary key,
  owner_id uuid not null,
  asset_id text not null unique,
  request jsonb not null,
  filename text not null,
  size_bytes bigint not null check(size_bytes between 1 and 52428800),
  checksum text not null check(checksum ~ '^[a-f0-9]{64}$'),
  mime text not null,
  purpose text not null check(purpose in ('avatar','project_cover','submission')),
  bucket text not null check(bucket in ('media','submissions')),
  pending_path text not null unique,
  ready_path text not null unique,
  state text not null default 'reserved' check(state in ('reserved','finalizing','ready','cancelled','cleaning')),
  expires_at timestamptz not null default now()+interval '15 minutes',
  -- Supabase signed upload tokens last two hours. Record BEFORE issuing one;
  -- cancelled/expired/ready reservations retain bytes through the latest possible
  -- issuance at expires_at, plus two hours and five minutes of clock/flight grace.
  retain_until timestamptz not null default now()+interval '140 minutes',
  lease_token uuid,
  lease_until timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index media_upload_one_active_owner on public.media_upload_reservations(owner_id)
  where state in ('reserved','finalizing');
create index media_upload_cleanup_due on public.media_upload_reservations(retain_until)
  where released_at is null;
alter table public.media_upload_limits enable row level security;
alter table public.media_upload_reservations enable row level security;
revoke all on public.media_upload_limits, public.media_upload_reservations from public, anon, authenticated;
grant all on public.media_upload_limits, public.media_upload_reservations to service_role;

create function public.media_upload_reserve(p_owner uuid,p_id uuid,p_asset text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.media_upload_reservations%rowtype; used numeric; held numeric; capacity bigint; n bigint; filename text; bucket text;
begin
  perform pg_advisory_xact_lock(817004007);
  select * into r from public.media_upload_reservations where id=p_id for update;
  if found then
    if r.owner_id<>p_owner then raise exception 'UPLOAD_NOT_FOUND'; end if;
    if r.request<>p_request then raise exception 'UPLOAD_CONFLICT'; end if;
    if r.state='ready' then return to_jsonb(r); end if;
    if r.expires_at<=now() then raise exception 'UPLOAD_EXPIRED'; end if;
    -- An expired finalize lease is recoverable through the same reserve-first
    -- browser flow. Fence the old worker without freeing or reallocating bytes.
    if r.state='finalizing' and (r.lease_until is null or r.lease_until<=now()) then
      update public.media_upload_reservations set state='reserved',lease_token=null,lease_until=null
        where id=p_id returning * into r;
    end if;
    if r.state<>'reserved' then raise exception 'UPLOAD_BUSY'; end if;
    update public.media_upload_reservations set retain_until=greatest(retain_until,expires_at+interval '125 minutes') where id=p_id returning * into r;
    return to_jsonb(r);
  end if;
  n := (p_request->>'size')::bigint; filename:=p_request->>'name';
  if p_owner is null or p_id is null or p_asset is null or p_asset !~ '^asset_[A-Za-z0-9]+$'
    or n is null or n<1 or n>52428800 or filename is null or filename !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
    or p_request->>'checksum' is null or p_request->>'checksum' !~ '^[a-f0-9]{64}$'
    or p_request->>'mime' is null or p_request->>'purpose' is null or p_request->>'purpose' not in ('avatar','project_cover','submission') then
    raise exception 'INVALID_UPLOAD';
  end if;
  -- Admission expires independently from token/byte quarantine. A page reload
  -- may lose its client UUID; retire only expired rows without a live worker.
  -- No object, retention horizon or released_at value changes here.
  update public.media_upload_reservations set state='cancelled',lease_token=null,lease_until=null
    where owner_id=p_owner and state in ('reserved','finalizing') and expires_at<=now()
      and (lease_until is null or lease_until<=now());
  if exists(select 1 from public.media_upload_reservations where owner_id=p_owner and state in ('reserved','finalizing')) then raise exception 'UPLOAD_ACTIVE'; end if;
  select capacity_bytes into capacity from public.media_upload_limits where singleton;
  if capacity is null then raise exception 'UPLOAD_CAPACITY'; end if;
  -- All buckets count, including imports, certificates and unreferenced objects.
  -- Unknown sizes fail closed. Each reservation covers both pending and ready
  -- copies, less the bytes already included in storage.objects.
  select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else capacity end),0)
    into used from storage.objects;
  select coalesce(sum(greatest(2*q.size_bytes-coalesce((select sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::numeric else capacity end)
    from storage.objects o where o.bucket_id=q.bucket and o.name in(q.pending_path,q.ready_path)),0),0)),0)
    into held from public.media_upload_reservations q where released_at is null;
  if used+held+2*n>capacity then raise exception 'UPLOAD_CAPACITY'; end if;
  bucket:=case when p_request->>'purpose'='submission' then 'submissions' else 'media' end;
  insert into public.media_upload_reservations(id,owner_id,asset_id,request,filename,size_bytes,checksum,mime,purpose,bucket,pending_path,ready_path)
    values(p_id,p_owner,p_asset,p_request,filename,n,p_request->>'checksum',p_request->>'mime',p_request->>'purpose',bucket,
      'direct-pending/'||p_owner||'/'||p_id||'/'||filename,'direct-ready/'||p_owner||'/'||p_asset||'/'||filename) returning * into r;
  return to_jsonb(r);
end $$;

create function public.media_upload_transition(p_owner uuid,p_id uuid,p_action text,p_lease uuid default null,p_extra jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.media_upload_reservations%rowtype;
begin
  perform pg_advisory_xact_lock(817004007);
  select * into r from public.media_upload_reservations where id=p_id for update;
  if not found or r.owner_id<>p_owner then raise exception 'UPLOAD_NOT_FOUND'; end if;
  if p_action='get' then return to_jsonb(r); end if;
  if p_action='signed' then
    if r.state<>'reserved' then raise exception 'UPLOAD_BUSY'; end if;
    if r.expires_at<=now() then raise exception 'UPLOAD_EXPIRED'; end if;
    if (p_extra->>'expiresAt')::timestamptz is null or (p_extra->>'expiresAt')::timestamptz<=now() then raise exception 'INVALID_UPLOAD'; end if;
    update public.media_upload_reservations set retain_until=greatest(retain_until,(p_extra->>'expiresAt')::timestamptz+interval '5 minutes')
      where id=p_id returning * into r;
  elsif p_action='claim' then
    if r.state='ready' then return to_jsonb(r); end if;
    if r.expires_at<=now() then raise exception 'UPLOAD_EXPIRED'; end if;
    if r.state not in ('reserved','finalizing') or r.lease_until>now() then raise exception 'UPLOAD_BUSY'; end if;
    update public.media_upload_reservations set state='finalizing',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=p_id returning * into r;
  elsif p_action='retry' then
    if r.state<>'finalizing' or r.lease_token is distinct from p_lease then raise exception 'UPLOAD_BUSY'; end if;
    update public.media_upload_reservations set state='reserved',lease_token=null,lease_until=null where id=p_id returning * into r;
  elsif p_action='complete' then
    if r.state='ready' then return to_jsonb(r); end if;
    if r.state<>'finalizing' or r.lease_token is distinct from p_lease or r.lease_until<=now() then raise exception 'UPLOAD_BUSY'; end if;
    if r.expires_at<=now() then raise exception 'UPLOAD_EXPIRED'; end if;
    if not exists(select 1 from storage.objects where bucket_id=r.bucket and name=r.ready_path
      and metadata->>'size'=r.size_bytes::text and metadata->>'mimetype'=r.mime) then raise exception 'UPLOAD_NOT_FOUND'; end if;
    insert into public.media_assets(id,owner_id,bucket,path,purpose,item_id,mime,size_bytes,width,height)
      values(r.asset_id,r.owner_id,r.bucket,r.ready_path,r.purpose,r.request->>'itemId',r.mime,r.size_bytes,
        (p_extra->>'width')::int,(p_extra->>'height')::int);
    if r.purpose='avatar' then
      update public.profiles set avatar_url='/api/v1/media/'||r.asset_id where id=r.owner_id;
      if not found then raise exception 'UPLOAD_PROFILE_MISSING'; end if;
    end if;
    update public.media_upload_reservations set state='ready',lease_token=null,lease_until=null where id=p_id returning * into r;
  elsif p_action='cancel' then
    if r.state='ready' then raise exception 'UPLOAD_FINALIZED'; end if;
    if r.state='cleaning' or r.lease_until>now() then raise exception 'UPLOAD_BUSY'; end if;
    update public.media_upload_reservations set state='cancelled',lease_token=null,lease_until=null where id=p_id returning * into r;
  elsif p_action='cleanup' then
    if r.released_at is not null then return to_jsonb(r); end if;
    if r.retain_until>now() or r.lease_until>now() then raise exception 'UPLOAD_BUSY'; end if;
    update public.media_upload_reservations set state=case when state='ready' then 'ready' else 'cleaning' end,
      lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=p_id returning * into r;
  elsif p_action='release' then
    if r.released_at is not null then return to_jsonb(r); end if;
    if r.state not in ('cleaning','ready') or r.lease_token is null or r.lease_token is distinct from p_lease
      or r.lease_until<=now() or r.retain_until>now() then raise exception 'UPLOAD_BUSY'; end if;
    if exists(select 1 from storage.objects where bucket_id=r.bucket and
      (name=r.pending_path or (r.state<>'ready' and name=r.ready_path))) then raise exception 'UPLOAD_BYTES_REMAIN'; end if;
    update public.media_upload_reservations set state=case when state='ready' then 'ready' else 'cancelled' end,
      released_at=now(),lease_token=null,lease_until=null where id=p_id returning * into r;
  else raise exception 'INVALID_UPLOAD_ACTION'; end if;
  return to_jsonb(r);
end $$;

create function public.media_upload_cleanup_candidates(p_limit int default 10)
returns setof public.media_upload_reservations language sql security definer set search_path='' as $$
  select * from public.media_upload_reservations where released_at is null and retain_until<=now()
    and (lease_until is null or lease_until<=now()) order by retain_until,id limit greatest(0,least(p_limit,25));
$$;
revoke all on function public.media_upload_reserve(uuid,uuid,text,jsonb), public.media_upload_transition(uuid,uuid,text,uuid,jsonb), public.media_upload_cleanup_candidates(int) from public,anon,authenticated;
grant execute on function public.media_upload_reserve(uuid,uuid,text,jsonb), public.media_upload_transition(uuid,uuid,text,uuid,jsonb), public.media_upload_cleanup_candidates(int) to service_role;
