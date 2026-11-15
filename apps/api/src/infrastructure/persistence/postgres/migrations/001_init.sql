-- ひみつ出欠: initial schema (spec §7)

create table rooms (
  id               text primary key check (id ~ '^[A-Za-z0-9]{1,32}$'),
  title            text not null check (char_length(title) between 1 and 100),
  deadline_text    text not null default '' check (char_length(deadline_text) <= 50),
  message          text not null default '' check (char_length(message) <= 500),
  status           text not null check (status in ('open', 'closed')),
  admin_token_hash text not null unique,
  created_at       timestamptz not null,
  closed_at        timestamptz,
  purge_after      timestamptz not null
);
create index rooms_purge_after_idx on rooms (purge_after);

create table members (
  id                uuid primary key,
  room_id           text not null references rooms (id) on delete cascade,
  display_name      text not null check (char_length(display_name) between 1 and 50),
  invite_token_hash text not null unique,
  invite_token_enc  text,
  invite_used_at    timestamptz,
  member_token_hash text unique,
  sort_order        int not null,
  created_at        timestamptz not null,
  unique (room_id, display_name),
  -- the encrypted invite token exists only while unused
  check (invite_used_at is null or invite_token_enc is null),
  check ((invite_used_at is null) = (member_token_hash is null))
);
create index members_room_idx on members (room_id, sort_order);

create table answers (
  member_id      uuid primary key references members (id) on delete cascade,
  choice         text not null check (choice in ('yes', 'no', 'cond')),
  cond_people    uuid[] not null default '{}',
  cond_need      int not null default 0 check (cond_need >= 0),
  cond_min_total int not null default 0 check (cond_min_total >= 0 and cond_min_total <= 99),
  updated_at     timestamptz not null,
  check (choice <> 'cond' or cond_need >= 1 or cond_min_total >= 1),
  check (cond_need <= coalesce(array_length(cond_people, 1), 0))
);

create table results (
  room_id     text primary key references rooms (id) on delete cascade,
  attending   uuid[] not null,
  computed_at timestamptz not null
);

create table audit_events (
  id         bigint generated always as identity primary key,
  room_id    text not null references rooms (id) on delete cascade,
  member_id  uuid,
  actor      text not null check (actor in ('admin', 'member', 'system')),
  action     text not null check (action in (
               'member_added', 'member_removed', 'invite_reissued', 'invite_claimed',
               'answer_saved', 'room_closed', 'room_reopened', 'settings_changed')),
  created_at timestamptz not null
);
create index audit_events_member_idx on audit_events (room_id, member_id, id);

-- §7.3: at most 100 members per room, enforced by the database as well.
create function enforce_member_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from members where room_id = new.room_id) >= 100 then
    raise exception 'member limit exceeded' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger members_limit before insert on members
  for each row execute function enforce_member_limit();

-- §7.3: cond_people may only reference members of the same room (at write time).
create function enforce_cond_people_same_room() returns trigger
language plpgsql as $$
declare
  v_room text;
begin
  select room_id into v_room from members where id = new.member_id;
  if new.member_id = any (new.cond_people) then
    raise exception 'cond_people must not include self' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from unnest(new.cond_people) as p(id)
    where not exists (select 1 from members m where m.id = p.id and m.room_id = v_room)
  ) then
    raise exception 'cond_people must be members of the same room' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger answers_cond_people before insert or update on answers
  for each row execute function enforce_cond_people_same_room();

-- §7.4: RLS on with no policies (deny all) for every table.
alter table rooms enable row level security;
alter table members enable row level security;
alter table answers enable row level security;
alter table results enable row level security;
alter table audit_events enable row level security;

-- §7.4: on Supabase, also revoke everything from the browser-facing roles.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke execute on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke execute on functions from %I', r);
    end if;
  end loop;
end
$$;
