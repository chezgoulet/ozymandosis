-- Retire the store scheme (docs/MONETIZATION.md, the owner ruling of 2026-11-05): the app is
-- free and sold in no store, Stripe on the website is the only billing rail, and there is
-- nothing left that a store must vouch for.
--
-- What goes now:
--   * `ownerships` — proof that a store confirmed the player bought the game. Its only readers
--     were /api/ownership/*, removed in this release. Nothing else touches it, so dropping it
--     here is safe for a rollback: the previous image would answer those already-dead routes
--     with an error, and no other path notices.
--   * the encrypted store purchase tokens themselves.
--
-- On the tokens, precisely: the previous image never *reads* this column — it writes it when a
-- StoreKit transaction is synced (billing/appstore.ts) and wipes it on account deletion
-- (auth/me.ts). So nulling it is invisible to a rollback, and the direction of the risk is the
-- other way: a token written by a rolled-back image during a deploy window would survive, because
-- this migration is recorded in schema_migrations and never runs a second time. That is why
-- deleteAccount() keeps its per-account wipe until the columns are gone.
--
-- What deliberately stays until the NEXT release: subscriptions.platform, store_token_enc and
-- store_product, and the index over them. deploy.sh rolls back to the previous image when a new
-- one does not come up healthy, and the previous image's entitlements() still selects `platform`
-- from every subscription — dropping that column in this release would turn a rollback into an
-- outage on /api/me and every WebSocket sign-in. Per the rule at the top of deploy.sh, the
-- columns go in the release after the one that stops reading them.
--
-- Those columns still hold real data for anyone who bought through a store before 2026-11-05, and
-- the data inventory says so. They are not dead storage; only unwritten.

drop table if exists ownerships;

update subscriptions set store_token_enc = null where store_token_enc is not null;
