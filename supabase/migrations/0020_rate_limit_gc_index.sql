-- Support periodic expiry scans without rewriting immutable migration 0019.
create index rate_limits_window_started_at_idx
  on public.rate_limits (window_started_at);
