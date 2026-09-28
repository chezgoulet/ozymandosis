-- Operations: heartbeats from outside the service (backups), alerts already
-- sent (so they are not repeated), ticket-key retirement, and balance numbers.
create table ops_heartbeats (
  name text primary key,
  at timestamptz not null default now(),
  ok boolean not null default true,
  detail jsonb not null default '{}'
);
create table ops_alerts (
  key text primary key,
  title text not null,
  body text not null default '',
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  sent_at timestamptz,
  count integer not null default 1,
  resolved_at timestamptz
);
alter table server_keys add column retired_at timestamptz;

-- Balance: aggregate outcomes of confirmed online matches (no per-player rows).
create table balance_cultures (
  day date not null,
  mode text not null,
  culture text not null,
  games integer not null default 0,
  wins integer not null default 0,
  primary key (day, mode, culture)
);
create table balance_designs (
  sig text primary key,           -- chassis + sorted organs
  chassis text not null,
  organs text[] not null,
  games integer not null default 0,
  wins integer not null default 0,
  hatched bigint not null default 0,
  last_day date not null default current_date
);
