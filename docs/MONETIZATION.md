# Monetization — the scheme of record

**Owner ruling, 2026-11-05 (final).** This supersedes the 2026-09-28 store scheme and the
2026-10-06 partial revision. There are no store sales, no $1 purchase, and no platform
entitlements. The app is free; the only paid product is worldwide online multiplayer.

## The scheme

- **The app is free.** It is distributed through **Obtainium** today and is being submitted to
  **F-Droid**. There is no Google Play, App Store or Steam listing, and no in-app purchase.
- **Single-player and local-network play are free**, with no account and no relay. The whole
  game is playable offline and on a home network.
- **Worldwide online play** is the paid service. It uses the relay, matchmaking, accounts,
  moderation and the rest of the play service.
- **One full match per rolling 24 hours is free**, counted when the match starts, whether the
  player hosts or joins, per account. This is an allowance, not a product.
- **Membership removes the allowance**: **$2/month or $12/year**, bought on the website
  (`play.ozymandosis.com/account`) through Stripe Checkout. It renews and cancels in the
  Stripe customer portal. A web membership counts everywhere, because the subscription row
  carries no platform.
- **No store subscriptions. No cross-billing.** There is nothing to buy in an app store, and
  no store receipt to validate. Stripe is the only billing rail.

## What the player gets

| | Free | Membership |
|---|---|---|
| Single-player | Yes | Yes |
| Local-network multiplayer | Yes | Yes |
| Worldwide online | One match per rolling 24h | Unlimited |
| Account | Needed only for online | Needed |
| Price | $0 | $2/month or $12/year |

The game is **AGPL-3.0-only**. The source is public; anyone running a modified version as a
service must offer the source. The paid membership buys reach through the service, not a
proprietary licence and not content.

## The operating split

- **Chez Goulet LLC** owns the game IP and licenses it under AGPL-3.0.
- **Sorcelot LLC** operates the play service: accounts, Stripe billing, matchmaking, relay,
  moderation, support and the Linode deployment.
- The website terms and privacy policy must name Sorcelot LLC as the service operator.

## The numbers

- **$12/year** nets about **$11.35** after Stripe's standard 2.9% + $0.30 (US card), before
  tax and hosting.
- **$2/month** nets about **$1.64** per month after the same fee.
- At **$1.70 net per subscriber-month**, the Linode/hosting cost is covered by roughly
  **8 subscribers** on the $12/month shared plan; see `docs/HOSTING.md` for the current
  configuration.
- The old "$1 game sale" arithmetic — store cuts, Steam Direct fees, per-platform
  entitlements — no longer applies and is removed from the scheme.

## What this settles

- **No store policy applies.** The app is free and distributed outside the stores; there is
  no Apple 3.1.3(b), Play Billing, StoreKit or Steamworks question.
- **No platform entitlements.** The only entitlement is the server-side membership row
  created by Stripe.
- **No free hole through a browser.** There is no browser build; the Android app is the
  client, and the website is the account/billing portal, not the game.
- **Cross-play is trivial.** All players are on the same server-mediated service; there is no
  platform split to bridge.

## Historical note

`docs/STORES.md`, the store sections of `docs/RELEASE-CHECKLIST.md`,
`docs/RELEASE-PLAN.md`, `docs/WORK-ORDER-FIRST-RELEASE.md` and the older `docs/DECISIONS.md`
entries describe a store scheme that is no longer current. Keep them as history; do not
follow them for launch. The current launch checklist is `docs/LAUNCH.md`, and the current
billing configuration is `docs/DEPLOY.md` §7.
