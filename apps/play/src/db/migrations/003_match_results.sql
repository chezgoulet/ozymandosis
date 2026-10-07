-- Match results are settled from every player's claim, not the host's word alone.
alter table matches add column status text not null default 'open' check (status in ('open', 'confirmed', 'disputed', 'void'));
alter table matches add column claims jsonb not null default '{}';
alter table matches add column rated boolean not null default false;
alter table matches add column first_claim_at timestamptz;
alter table matches add column settled_at timestamptz;
alter table matches add column verdict text;
update matches set status = 'confirmed', settled_at = ended_at where ended_at is not null;
create index matches_open_idx on matches (status, first_claim_at) where status = 'open';
create index matches_disputed_idx on matches (started_at desc) where status = 'disputed';
alter table match_players add column rating_delta integer;
