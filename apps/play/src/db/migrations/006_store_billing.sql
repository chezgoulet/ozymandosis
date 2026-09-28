-- Store billing (work order §3). A subscription row may now come from an app store.
-- platform: null for sources honoured everywhere (Stripe, promo codes, gifts);
-- 'android' for Google Play. Subscriptions do not cross platforms
-- (docs/MONETIZATION.md), so a store row only counts on its own platform.
alter table subscriptions add column platform text;
-- the store's purchase token, encrypted with SECRET_KEY (needed to re-check it with the store)
alter table subscriptions add column store_token_enc text;
-- the store's product and plan (e.g. ozymandosis_membership / monthly)
alter table subscriptions add column store_product text;
create index subscriptions_platform_idx on subscriptions (user_id, platform);
