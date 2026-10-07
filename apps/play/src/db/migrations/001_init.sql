-- Ozymandosis play service schema.
-- Personal data kept to what the service needs: an email for sign-in and
-- recovery, provider subject ids for linked logins, and a Stripe customer id.
-- No IP addresses, no device fingerprints, no names beyond the display name.

create table users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  name_key text not null unique,
  email text unique,
  email_verified boolean not null default false,
  password_hash text,
  totp_secret_enc text,
  totp_enabled boolean not null default false,
  totp_last_step bigint,
  role text not null default 'player' check (role in ('player', 'support', 'moderator', 'admin', 'owner')),
  status text not null default 'active' check (status in ('active', 'suspended', 'banned', 'deleted')),
  suspended_until timestamptz,
  muted_until timestamptz,
  stripe_customer_id text unique,
  rating integer not null default 1200,
  matches integer not null default 0,
  wins integer not null default 0,
  crash_reports boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index users_created_idx on users (created_at);

create table identities (
  provider text not null,
  subject text not null,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);
create index identities_user_idx on identities (user_id);

create table recovery_codes (
  user_id uuid not null references users (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  primary key (user_id, code_hash)
);

-- Opaque bearer/cookie sessions: only the SHA-256 of the token is stored.
create table sessions (
  id text primary key,
  user_id uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('web', 'game')),
  client text not null default '',
  mfa boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions (user_id);

create table email_tokens (
  token_hash text primary key,
  user_id uuid not null references users (id) on delete cascade,
  purpose text not null check (purpose in ('verify', 'reset', 'mfa')),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Game clients sign in through the browser: they hold a secret verifier and
-- poll with it; the portal attaches the signed-in user to the verifier's hash.
create table login_handoffs (
  id text primary key,
  user_id uuid references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz
);

create table oauth_states (
  state text primary key,
  provider text not null,
  code_verifier text,
  handoff text,
  link_user uuid,
  return_to text,
  expires_at timestamptz not null
);

create table subscriptions (
  id text primary key,
  user_id uuid not null references users (id) on delete cascade,
  status text not null,
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_user_idx on subscriptions (user_id);

create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  mode text not null default 'custom',
  host_id uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  winner_team integer,
  duration_s integer
);
create index matches_started_idx on matches (started_at);

create table match_players (
  match_id uuid not null references matches (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  slot integer not null,
  until timestamptz,
  result text,
  primary key (match_id, user_id)
);

-- Crash and bug reports, grouped into issues by fingerprint.
create table issues (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  kind text not null check (kind in ('crash', 'bug')),
  title text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored', 'regressed')),
  count integer not null default 0,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_version text,
  resolved_in text,
  versions jsonb not null default '{}',
  platforms jsonb not null default '{}',
  notes text not null default ''
);
create index issues_last_seen_idx on issues (last_seen desc);

create table reports (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  version text,
  platform text,
  renderer text,
  message text,
  stack text,
  description text,
  context jsonb not null default '{}',
  screenshot text
);
create index reports_issue_idx on reports (issue_id, created_at desc);

create table player_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references users (id) on delete set null,
  target_id uuid not null references users (id) on delete cascade,
  reason text not null check (reason in ('cheating', 'harassment', 'name', 'spam', 'griefing', 'other')),
  details text not null default '',
  match_id uuid references matches (id) on delete set null,
  chat jsonb not null default '[]',
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_by uuid references users (id) on delete set null,
  resolved_at timestamptz,
  resolution text
);
create index player_reports_status_idx on player_reports (status, created_at);

create table sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('warn', 'mute', 'unmute', 'suspend', 'ban', 'unban', 'rename', 'reset_mfa', 'revoke_sessions')),
  reason text not null default '',
  until timestamptz,
  by_user uuid references users (id) on delete set null,
  report_id uuid references player_reports (id) on delete set null,
  created_at timestamptz not null default now()
);
create index sanctions_user_idx on sanctions (user_id, created_at desc);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  audience text not null default 'all' check (audience in ('all', 'subscribers', 'free')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid references users (id) on delete set null,
  action text not null,
  target text,
  detail jsonb not null default '{}'
);
create index audit_log_at_idx on audit_log (at desc);

create table remote_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id) on delete set null
);

create table server_keys (
  id text primary key,
  public_key text not null,
  private_enc text not null,
  created_at timestamptz not null default now()
);

-- Daily counters for the dashboard (no per-user rows: aggregate only).
create table daily_stats (
  day date not null,
  key text not null,
  value bigint not null default 0,
  primary key (day, key)
);
