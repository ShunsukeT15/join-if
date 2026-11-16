-- Conditional answers become an OR of patterns (spec change: §4.3 "(A and B) or C").
-- Each pattern: {"people": [uuid...], "need": N, "minTotal": M}; inside a pattern both parts must hold.

alter table answers add column cond_patterns jsonb not null default '[]'::jsonb;

-- Existing answers: the single (people, N, M) condition becomes one pattern.
update answers
set cond_patterns = case
  when choice = 'cond' then jsonb_build_array(jsonb_build_object(
    'people', to_jsonb(cond_people), 'need', cond_need, 'minTotal', cond_min_total))
  else '[]'::jsonb
end;

drop trigger answers_cond_people on answers;
drop function enforce_cond_people_same_room();
-- Also drops the CHECK constraints that referenced these columns.
alter table answers
  drop column cond_people,
  drop column cond_need,
  drop column cond_min_total;

alter table answers add constraint answers_patterns_shape check (
  jsonb_typeof(cond_patterns) = 'array'
  and (
    (choice = 'cond' and jsonb_array_length(cond_patterns) between 1 and 5)
    or (choice <> 'cond' and jsonb_array_length(cond_patterns) = 0)
  )
);

-- §7.3 (defence in depth): every pattern is well-formed and references only
-- members of the same room (at write time), never the answerer.
create function enforce_cond_patterns() returns trigger
language plpgsql as $$
declare
  v_room   text;
  p        jsonb;
  v_people uuid[];
  v_need   int;
  v_min    int;
begin
  select room_id into v_room from members where id = new.member_id;
  for p in select value from jsonb_array_elements(new.cond_patterns) loop
    if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'people') <> 'array' then
      raise exception 'invalid pattern' using errcode = 'check_violation';
    end if;
    v_people := array(select jsonb_array_elements_text(p -> 'people')::uuid);
    v_need   := coalesce((p ->> 'need')::int, 0);
    v_min    := coalesce((p ->> 'minTotal')::int, 0);

    if new.member_id = any (v_people) then
      raise exception 'pattern must not include self' using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from unnest(v_people) as x(id)
      where not exists (select 1 from members m where m.id = x.id and m.room_id = v_room)
    ) then
      raise exception 'pattern people must be members of the same room' using errcode = 'check_violation';
    end if;
    if v_need < 0 or v_need > coalesce(array_length(v_people, 1), 0) then
      raise exception 'pattern need out of range' using errcode = 'check_violation';
    end if;
    if v_min < 0 or v_min > 99 then
      raise exception 'pattern minTotal out of range' using errcode = 'check_violation';
    end if;
    if v_need < 1 and v_min < 1 then
      raise exception 'pattern needs a person or headcount condition' using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end
$$;

create trigger answers_cond_patterns before insert or update on answers
  for each row execute function enforce_cond_patterns();

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke execute on function enforce_cond_patterns() from %I', r);
    end if;
  end loop;
end
$$;
