-- Ownership (docs/MONETIZATION.md, "Entitlements"): the $1 purchase, bound to the
-- account, per platform, each proof checked with that platform's store. One row per
-- account and platform; `evidence` is a hash of what proved it, not the proof itself.
create table ownerships (
  user_id uuid not null references users (id) on delete cascade,
  platform text not null,
  verified_at timestamptz not null default now(),
  evidence text not null,
  primary key (user_id, platform)
);
