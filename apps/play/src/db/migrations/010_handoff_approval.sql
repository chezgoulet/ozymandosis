-- A hand-off is now an explicit approval: the requesting client is shown a short
-- code and the signed-in browser must type it. Following a link is no longer
-- enough to sign a game client in. Pending rows from before this release simply
-- expire (their user_code is null, so they can never be approved).
alter table login_handoffs add column if not exists user_code text;
alter table login_handoffs add column if not exists client_hint text not null default '';
