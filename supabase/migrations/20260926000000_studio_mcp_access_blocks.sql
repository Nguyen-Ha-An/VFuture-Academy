-- Application-level MCP admission block. This does not revoke a Supabase OAuth grant.
-- A user_id key covers every current and future MCP OAuth client for that account.
create table public.studio_mcp_access_blocks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reason text check (reason is null or length(reason) between 1 and 500),
  blocked_by uuid references public.profiles(id) on delete set null,
  blocked_at timestamptz not null default now()
);

alter table public.studio_mcp_access_blocks enable row level security;
revoke all on public.studio_mcp_access_blocks from public, anon, authenticated;
grant select, insert, update, delete on public.studio_mcp_access_blocks to service_role;
