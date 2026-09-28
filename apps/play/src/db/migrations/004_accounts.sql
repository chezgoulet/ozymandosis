-- Cloud sync of lineage, designs and saves; age bands; chat preference.
create table cloud_items (
  user_id uuid not null references users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  version integer not null default 1,
  size integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
-- Only a band is kept, never a birth date. Null: not asked yet (asked before online play).
alter table users add column age_band text check (age_band in ('13-15', '16-17', 'adult'));
alter table users add column chat text not null default 'all' check (chat in ('all', 'quick', 'off'));
