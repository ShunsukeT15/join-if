-- Events: an organizer groups several communities (rooms) and sees totals.
-- Each community keeps its own invitation, deadline, close and result.

create table events (
  id               text primary key check (id ~ '^[A-Za-z0-9]{1,32}$'),
  title            text not null check (char_length(title) between 1 and 100),
  message          text not null default '' check (char_length(message) <= 500),
  admin_token_hash text not null unique,
  created_at       timestamptz not null,
  purge_after      timestamptz not null
);
create index events_purge_after_idx on events (purge_after);

alter table rooms
  add column event_id text references events (id) on delete cascade,
  add column community_name text check (char_length(community_name) between 1 and 50);

alter table rooms add constraint rooms_community check ((event_id is null) = (community_name is null));
create index rooms_event_idx on rooms (event_id, created_at) where event_id is not null;

-- Communities of one event share the event's admin token.
alter table rooms drop constraint rooms_admin_token_hash_key;
create index rooms_admin_token_hash_idx on rooms (admin_token_hash);

alter table audit_events drop constraint audit_events_action_check;
alter table audit_events add constraint audit_events_action_check check (action in (
  'member_added', 'member_removed', 'invite_reissued', 'invite_claimed', 'answer_saved',
  'room_closed', 'room_reopened', 'settings_changed', 'group_token_reissued', 'community_created'));

alter table events enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on events from %I', r);
    end if;
  end loop;
end
$$;
