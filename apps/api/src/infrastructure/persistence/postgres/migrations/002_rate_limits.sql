-- Shared rate-limit counters (spec §8.5, open issue #3) so limits hold across
-- multiple API instances (e.g. AWS Lambda). Keys are hashed; no raw IPs or tokens.
create table rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        int not null
);
create index rate_limits_window_idx on rate_limits (window_start);
alter table rate_limits enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on rate_limits from %I', r);
    end if;
  end loop;
end
$$;
