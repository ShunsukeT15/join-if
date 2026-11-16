-- Group invitation (one shared URL; members pick their name once) and automatic deadlines.

alter table rooms
  add column invite_mode text not null default 'individual' check (invite_mode in ('individual', 'group')),
  add column group_token_hash text unique,
  add column group_token_enc text,
  add column deadline_at timestamptz;

alter table rooms add constraint rooms_group_token check (
  (invite_mode = 'group') = (group_token_hash is not null)
  and (group_token_hash is null) = (group_token_enc is null)
);

-- The scheduled close looks up open rooms past their deadline.
create index rooms_open_deadline_idx on rooms (deadline_at) where status = 'open' and deadline_at is not null;

-- Group-mode members have no per-member invite URL.
alter table members alter column invite_token_hash drop not null;

-- New audit action.
alter table audit_events drop constraint audit_events_action_check;
alter table audit_events add constraint audit_events_action_check check (action in (
  'member_added', 'member_removed', 'invite_reissued', 'invite_claimed', 'answer_saved',
  'room_closed', 'room_reopened', 'settings_changed', 'group_token_reissued'));
