# Monetization — the scheme of record

**Owner ruling, 2026-09-28 (final).** This is the decision of record. It changes
the policy in **D12**: D12 describes the ticket *mechanism* correctly and that
mechanism stands, but the policy it enforces is no longer a per-match time limit.

## The scheme

- **$1 to download.** Single-player is unencumbered and fully featured, and the
  purchase includes **all future content**.
- **One full match per rolling 24 hours**, free. **Whether you start that match
  or join someone else's makes no difference** — it is one match, counted once,
  whichever side of it you are on.
- **Beyond that: $2/month** (mobile only) **or $12/year** (mobile and Steam; on
  Steam sold as a season).
- **Subscriptions do not cross platforms.** Buy it on Steam and play it there;
  buy it on iOS and play it there. Someone who wants it everywhere buys each
  platform's subscription. Walled gardens are not being fought.
- **There is no browser version.** The game ships on Steam, iOS and Android only,
  despite being a WebGPU game. `play.ozymandosis.com` is the service — accounts,
  billing, moderation, admin — not a game client.

## The allowance

- **Rolling 24-hour window**, not local midnight. On midnight, a player games at
  23:59 and again at 00:01 and gets two free matches in two minutes.
- **One match, however long it runs.** There is no time limit inside a match.
- **Counted when the match actually starts**, not when a lobby is created or a
  queue is entered — otherwise a failed start or a host disconnect burns
  someone's day.
- **Per account**, not per entitlement. Owning all three platforms must not yield
  three free matches a day.

## Entitlements

- Purchase and origin are **bound to the account on the Ozymandosis server**.
- Entitlements are **per platform**; one account may hold several.
- **Store-side validation is mandatory** as a consequence: the service must
  verify each purchase with the store (Play Developer API, App Store Server API,
  Steam ownership) rather than accept the client's word. Without it, "bound to
  the account" is decorative — a client can assert an entitlement it never
  bought.

## What this settles

- **Apple 3.1.3(b) is moot.** That guideline requires a subscription bought
  elsewhere to also be purchasable in-app *only if it is honoured across
  platforms*. Deliberately refusing to honour it across platforms removes the
  obligation. Still required on iOS: the mobile subscription must itself be an
  in-app purchase, in-app account deletion, and 4.8 login parity for the
  third-party sign-in providers.
- **The absence of a browser build closes the free hole.** There is no un-gated
  way to reach multiplayer, so the $1 genuinely gates it.
- **Cross-play still works.** A Steam player and an Android player can share a
  match, because matchmaking is server-mediated and platform-agnostic.
  **Cross-play, not cross-billing.**

## The numbers

- **$12/year nets $10.20** on Apple or Google and **$8.40** on
  Steam. **$2/month on mobile nets $1.70/month, or $20.40
  a year** — so the annual is a **50% discount**, which is
  steep. Most services sit near 17%. It will read as "annual is the real price,
  monthly is a penalty", which is presumably the intent, but it is a big nudge
  and worth being deliberate about.
- One annual subscriber is worth **12 app sales** on
  Apple/Google, 10 on Steam.
- Per 100 buyers at 3% conversion: **$115.60 in year one**
  and **$30.60 in year two** with no new buyers. Retention is the whole
  story after launch.
- A $20/month service needs **about 24 annual subscribers** —
  roughly 784 buyers at 3% conversion. At $10/month of
  service it is 12 subscribers.
- **Steam nets about 18% less than mobile for the
  same $12.** Matching the net would mean pricing the Steam season at about
  **$14.57**. Price parity across platforms is worth more than net
  parity to most players — worth choosing deliberately rather than by default.
- Steam additionally takes **$100 per app**, recouped only at $1,000 adjusted
  gross revenue — **1,000 sales at $1 a unit**.

## Open items

1. **The consume trigger cannot be verified server-side.** Multiplayer is P2P, so
   the server never sees the match; it sees the ticket handshake (D12). "Counted
   when they actually play" is therefore *"a match ticket was issued and
   consumed"*, which is client-trusted. That is consistent with D12's "a gentle
   nudge, not DRM" — stated rather than discovered.
2. **Content features do not pay for themselves.** With all content free forever
   for owners, post-launch revenue is copies and multiplayer time, nothing else.
   Multiplayer-adjacent work returns directly; single-player content is goodwill.
   Both are legitimate — they are not the same bet, and roadmap ordering should
   say which is which.
3. **A $1 paid app has no trial on any store.** The free daily match sells the
   *subscription*; nothing sells the *game*. If discovery turns out to be the
   constraint, the fix is a demo build — a free app with an in-app unlock, or a
   separate demo listing — not another window.
4. **The remote-config value changes shape.** `FREE_MATCH_MINUTES` becomes a
   per-day match allowance, and the signed ticket carries a count rather than an
   expiry.
