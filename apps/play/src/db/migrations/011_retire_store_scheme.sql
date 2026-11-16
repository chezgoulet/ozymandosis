-- Retire the store scheme (docs/MONETIZATION.md, the owner ruling of 2026-11-05): the app is
-- free and sold in no store, Stripe on the website is the only billing rail, and there is
-- nothing left that a store must vouch for.
--
-- What goes now:
--   * `ownerships` — proof that a store confirmed the player bought the game. Its only readers
--     were /api/ownership/*, removed in this release. Nothing else touches it, so dropping it
--     here is safe for a rollback: the previous image would answer those already-dead routes
--     with an error, and no other path notices.
--   * the encrypted store purchase tokens themselves. Nothing writes them from this release on,
--     and personal data we no longer need should not sit in the database waiting for a later
--     tidy-up. The previous image reads them as null, which it already handles.
--
-- What deliberately stays until the NEXT release: subscriptions.platform, store_token_enc and
-- store_product, and the index over them. deploy.sh rolls back to the previous image when a new
-- one does not come up healthy, and the previous image's entitlements() still selects `platform`
-- from every subscription — dropping that column in this release would turn a rollback into an
-- outage on /api/me and every WebSocket sign-in. Per the rule at the top of deploy.sh, the
-- columns go in the release after the one that stops reading them.

drop table if exists ownerships;

update subscriptions set store_token_enc = null where store_token_enc is not null;
