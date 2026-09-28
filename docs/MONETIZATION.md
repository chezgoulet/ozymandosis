# Monetization — the scheme of record

**Owner ruling, 2026-09-28.** This is the decision of record. It changes the
policy in **D12**: D12 describes the ticket *mechanism* correctly and that
mechanism stands, but the policy it enforces is no longer a per-match time limit.

## The scheme

- **$1 to buy the app.** Single-player is unencumbered and fully featured, and
  the purchase includes **all future content**.
- **One free multiplayer game per day**, of any length and any type.
- **More than one a day requires a subscription:** **$1/month** (mobile only) or
  **$10/year** (mobile and Steam; on Steam sold as a season).
- **Subscriptions do not cross platforms.** Buy it on Steam and play it there;
  buy it on iOS and play it there. Someone who wants it everywhere buys each
  platform's subscription. Walled gardens are not being fought.
- **There is no browser version.** The game ships on Steam, iOS and Android only,
  despite being a WebGPU game. `play.ozymandosis.com` is the service — accounts,
  billing, moderation, admin — not a game client.

## The allowance

- **Rolling 24-hour window**, not local midnight. On midnight, a player games at
  23:59 and again at 00:01 and gets two free games in two minutes.
- **Counted when they actually play**, not when they request or queue.
- **Consumed at match start**, not at lobby creation or in the queue — otherwise
  a failed start or a host disconnect burns someone's day.

## Entitlements

- Purchase and origin are **bound to the account on the Ozymandosis server**.
- Entitlements are **per platform**; one account may hold several.
- The daily allowance is **per account**, not per entitlement — owning all three
  platforms must not yield three free games a day.

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

## The numbers behind it

- $10/year nets **$8.50** on Apple or Google, **$7.00** on Steam. One annual
  subscriber is therefore worth **ten app sales**.
- Per 100 buyers at 3% conversion: **$110.50 in year one**, and **$25.50 in year
  two** with no new buyers. Retention is the whole story after launch.
- A $20/month service needs **about 28 annual subscribers** — roughly **940
  buyers** at 3% conversion. Annual earns ~17% less per subscriber than twelve
  $1 months, which is the price of guaranteed duration and one transaction
  instead of twelve.

## Open items

1. **Does joining a friend's hosted match consume the guest's daily game?** The
   current wording says yes — "play a multiplayer game". But the invited-friend
   case is exactly where generosity buys the most goodwill, and it costs almost
   nothing, because the match runs on the host's machine. Decide deliberately.
2. **The consume trigger cannot be verified server-side.** Multiplayer is P2P,
   so the server never sees the match; it sees the ticket handshake (D12).
   "Counted when they actually play" must therefore mean *"a match ticket was
   issued and consumed"*, which is client-trusted. That is consistent with D12's
   "a gentle nudge, not DRM" — it should be stated rather than discovered.
3. **Store purchase validation is required.** If entitlements are per platform
   and bound to accounts, the service must validate each purchase with the store
   (Play Developer API, App Store Server API, Steam ownership) rather than accept
   the client's word. Otherwise the binding is decorative.
4. **Content features do not pay for themselves.** With all content free forever
   for owners, post-launch revenue is copies and multiplayer time, nothing else.
   Multiplayer-adjacent work returns directly; single-player content is
   goodwill. Both are legitimate — they are not the same bet, and roadmap
   ordering should say which is which.
5. **A $1 paid app has no trial on any store.** The daily game sells the
   *subscription*; nothing sells the *game*. If discovery turns out to be the
   constraint, the fix is a demo build — a free app with an in-app unlock, or a
   separate demo listing — not another window.
