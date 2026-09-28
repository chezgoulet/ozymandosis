-- The frame-rate instrument (work order §5): one row per measured match, anonymous.
-- No user, no address: the device class the game derives, the renderer, and numbers.
create table perf_runs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  version text not null,
  platform text not null,
  device_class text not null,
  renderer text not null,
  mode text not null,
  seconds integer not null,
  frames integer not null,
  fps real not null,
  p50 real not null,
  p95 real not null,
  p99 real not null,
  below30 real not null,
  tier_start text,
  tier_end text,
  tier_changes integer not null,
  units_peak integer,
  detail jsonb not null default '{}'::jsonb
);
create index perf_runs_created_idx on perf_runs (created_at desc);
