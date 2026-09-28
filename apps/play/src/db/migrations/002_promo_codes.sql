-- Promo codes: free membership for a month, a year or life, each with a finite number of uses.
create table promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null check (kind in ('month', 'year', 'life')),
  max_uses integer not null check (max_uses >= 1),
  uses integer not null default 0,
  expires_at timestamptz,
  disabled boolean not null default false,
  note text not null default '',
  batch text,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index promo_codes_batch_idx on promo_codes (batch);

create table promo_redemptions (
  code_id uuid not null references promo_codes (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code_id, user_id)
);
create index promo_redemptions_user_idx on promo_redemptions (user_id);
