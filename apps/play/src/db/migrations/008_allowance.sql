-- The free online allowance (docs/MONETIZATION.md): one match per rolling 24 hours,
-- per account, counted when the match actually starts, whichever side the player is on.
-- A row per player per match already exists; it now records when it was counted and
-- whether it used the free allowance (members' matches do not). `until` (the old
-- per-match time limit) is no longer written.
alter table match_players add column counted_at timestamptz;
alter table match_players add column free_used boolean not null default false;
create index match_players_allowance_idx on match_players (user_id, counted_at) where free_used;
-- the old per-match minutes setting has no meaning any more
delete from remote_config where key = 'freeMatchMinutes';
