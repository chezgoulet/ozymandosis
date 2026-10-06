# play.ozymandosis.com

The play service (`apps/play`) introduces players and vouches for them. It never carries a match: games run peer to peer between players over encrypted WebRTC DataChannels.

## What it does

| Area | Summary |
|---|---|
| Accounts | Email and password (Argon2id), email verification, password reset, display names with a slur/evasion filter and reserved staff names. |
| Two-factor | TOTP (RFC 6238, any authenticator app), QR setup, 10 single-use recovery codes, replay protection (a code's time step is used once), email notice when turned on or off. Staff tools require 2FA on the current session in production. |
| Other sign-ins | Google and Apple (OpenID Connect; PKCE for Google) and Steam (OpenID 2.0 in the browser; `POST /api/auth/steam-ticket` for native Steam builds). A provider appears when its credentials are set. Linking by email happens only when both sides have verified it. |
| Game sign-in | Browser hand-off: the client registers `sha256(verifier)`, opens `/login?handoff=…`, the player signs in there by any method, the client claims a game session with the verifier. |
| Membership | Web: Stripe Checkout ($2/month and $12/year, created by `npm run admin -- stripe:setup 1200`), Stripe Customer Portal, signed and idempotent webhooks. Android: Google Play Billing, each purchase validated with the Play Developer API and kept current by Real-time Developer Notifications (`src/billing/play.ts`); it counts only on Android. `past_due` keeps access for 3 days. Staff and complimentary grants count as members. |
| Promo codes | Admins mint codes (one custom code or random batches up to 1,000, `OZY-XXXX-XXXX-XXXX` without look-alike characters) granting a month, a year or life, each with a finite number of uses, once per player, optional expiry, disable, CSV export and a redemption list. Players redeem in their account or in the game; months and years stack on existing free time. |
| Matchmaking | Public lobby browser, private lobbies (5-letter codes), rated quick match (duel; 4-player FFA that starts with 3 after 45 s). Rating gap widens the longer a player waits. A member hosts when possible. |
| Signaling | WebRTC offers, answers and ICE candidates, host↔guest only. TURN credentials (coturn REST format, 12 h, pseudonymous usernames). |
| Tickets | On start: an Ed25519-signed list of players (lobby id, user id, name, member, deadline). Re-issued when someone joins mid-match; earlier deadlines are kept. |
| Results | The host reports the winner and duration; match history and win counts are stored; ranked matches adjust Elo (K=24). |
| Crash and bug reports | `POST /api/reports`: scrubbed, grouped by fingerprint (message and top frames without line numbers or origins), sampled, version and platform histograms, regressions detected when a resolved issue reappears in the fixed-or-newer build. |
| Moderation | Player reports (with chat lines from the reporter's client), queue, warn, mute, suspend, ban, force rename, sign out everywhere, reset 2FA; role hierarchy; every action audited and applied live. |
| Announcements | Composed in the admin console, pushed instantly over WebSockets and fetched by clients at start; audience (all, members, free), severity, end time. |
| Live config | Maintenance mode (players disconnected from matchmaking; matches continue), minimum client version, free match minutes, feature flags. |
| Admin console | `/admin`: promo codes, dashboard (live players, lobbies, DAU/WAU/MAU, members, MRR, open crashes and reports, 30-day charts), crash triage, report queue, players, announcements, matches, config, audit log. |
| Operator CLI | `npm run admin -- create-owner <email> <password>`, `promote <email|name> <role>`, `grant <email|name> <days>`, `stripe:setup`, `migrate`. |

## Realtime protocol (`/ws`)

The first message must be `{op:'auth', token, version, proto, platform}`; the reply is `hello {user, ent, ice, key, announcements, config}`. Then:

| Client → server | Server → client |
|---|---|
| `host {title?, public?, max?}` or `host {claim}` (quick match) | `hosted {room, id: 0, ice}` |
| `join {room}` | `joined {room, id, ice, hostName}`; host gets `peer {id, name, uid, sub, rating, muted}` |
| `signal {to, data}` | `signal {from, data}` |
| `meta {players, max, mode, title, public}` (host) | |
| `lobbies` | `lobbies {list}` |
| `kick {id}` · `leave` | `left {id}` · `closed` (only before the match starts) |
| `start` (host) | `ticket {ticket, match}` to everyone |
| `end {match, kind, winnerTeam, results, audit}` (every player) | `result {match, status, rated, result, delta}` once settled |
| `queue {mode}` · `unqueue` | `queued {mode, waiting}` · `matched {room, role, mode}` |
| `ping` | `pong` |
| | pushes: `me`, `announcement`, `announcement.end`, `maintenance`, `upgrade`, `kicked`, `error` |

`proto` is the peer protocol (`E.PROTOCOL` in `js/net/net.js`). The lobby list, `join` and quick match only put together clients on the same protocol, so a store build that lags the web build never lands in a match it cannot play. Peers check it again themselves: the first DataChannel message each way is `{k:'hi', p, v}`, and a mismatch (or no hello within 6 s, i.e. an older build) is refused with a message naming both versions. This also covers LAN games, which never touch the service. Bump `E.PROTOCOL` whenever snapshots, commands, game data or the sim change incompatibly.

`hosted`, `joined`, `peer`, `signal`, `left` and `closed` are the same messages the LAN server speaks, so the client's `E.Relay` works with either. After a match starts, signaling drops don't send `left`/`closed`: the peers' own connection decides, so a blip to the server can't end a healthy game.

## Results you can trust

The server never sees a match, and the host runs its only simulation, so results are settled from everyone's word and checked against the host's own record (`src/realtime/results.ts`, `js/net/audit.js`):

- **Every player reports.** At the end each client sends a claim: `final` (with every player's result), `forfeit` (quit early: a loss by their own word) or `disconnected` (lost the match connection: does not accept a loss). The match settles when all have claimed, or 90 s after the first claim.
- **Only agreement counts.** Finals must agree on every player's result. A player who never claims accepts the others' account (leaving is losing); a player who claims `disconnected` and would be given a loss disputes it. Disputed matches change nothing until a moderator accepts one player's account in the admin console (Matches → Disputed).
- **Guests audit the host.** The sim is deterministic. Every 20 s the host commits to the SHA-256 of its full world state (in the snapshot stream; a hash reveals nothing). After the match each guest walks the windows between commitments in a random order, for about nine seconds: the host sends the two bounding states and the commands it applied in between; the guest checks the hashes, re-simulates the window, compares per-player facts (lumen, spore, creatures, health, structures, evolutions) with tolerances wide enough for cross-browser float drift, checks that every order it sent was applied, that its colony was never handed to a bot while connected, and that the committed states agree with what it was shown live. A `tamper` verdict disputes the match and files an automatic cheating report against the host with the evidence. Full states are only revealed after the match, so the audit leaks nothing during play.
- **Ratings are harder to farm.** Ranked Elo moves only for confirmed matches with a result for every player, at least 120 s long (measured by the server, not claimed), and at most three rated matches a day between the same group of players. Anyone in three disputes within a week is flagged for review.

## The free allowance, and who may play online

The scheme is `docs/MONETIZATION.md`; how it is implemented is D20.

- **One full online match per rolling 24 hours, per account** (`freeMatchesPerDay`, live-configurable). The service counts it when the host starts the match, once per player, whichever side; a rejoin is not counted again; members are never counted. A free player with none left is refused before hosting, joining or queueing (`error {code: 'allowance', allowance}`), with when the next one comes. There is no time limit inside a match.
- **Tickets** (v2) say who is in the match, who is a member and how many free matches each has left. Clients verify the Ed25519 signature.
- **Store apps only, with a verified purchase** (production): the client says its platform (`android`, `ios`, `steam`) and must hold a current proof of purchase for it (`/api/ownership/*`), checked with that store. Otherwise `error {code: 'app_only' | 'ownership'}`; the app proves ownership and reconnects by itself.
- **Memberships per platform**: Google Play (`billing/play.ts`), the App Store (`billing/appstore.ts`), Steam seasons (`billing/ownership.ts`). Each counts only on its own platform.

## Security

- Passwords: Argon2id (19 MiB, t=2). Login responses take the same time whether or not the account exists. Per-account and per-network rate limits on sign-in, sign-up, resets and 2FA.
- Sessions: 256-bit random tokens; only SHA-256 stored; sliding expiry (web 30 days, game 90 days); revoked on password reset, ban and "sign out everywhere".
- Cookies: HttpOnly, Secure (production), SameSite=Lax; state-changing cookie requests must carry `x-ozy`, which forces a CORS preflight that other origins can't pass with credentials. Bearer requests get `Access-Control-Allow-Origin` without credentials.
- Secrets at rest: TOTP secrets and the ticket signing key are AES-256-GCM encrypted with a key derived from `SECRET_KEY`.
- Pages: strict CSP (`script-src 'self'`), `frame-ancestors 'none'`, HSTS, nosniff, no referrer leakage.
- WebSockets: authenticate within 10 s, token-bucket flood control, 64 KB frame cap, signaling payload cap, host↔guest routing only.
- TURN: authenticated, quotas, and relaying into private address ranges is denied.
- Stripe: webhooks verified against the raw body; events recorded for idempotency; no card data reaches the service.

## Privacy

What is stored and why is in the site's privacy page (`chezgoulet/ozymandosis-site`). In short: email (sign-in and recovery), password hash, encrypted 2FA secret, provider account ids, display name, rating and match results, a coarse device label per session ("Chrome on Android"), Stripe customer id and membership status, reports. No IP addresses anywhere: not in the database, not in the service's logs (route, status, time, and an HMAC pseudonym of the user id), not in Caddy's access logs (filtered), not in coturn (logging off). Rate limiting keys are pseudonyms held in memory. Players can export their data and delete their account (the row is kept anonymised for match history and moderation records).

Retention is enforced by an hourly sweep (`src/lib/retention.ts`, one instance at a time via an advisory lock): expired sessions and tokens, Stripe event ids after 90 days, report screenshots after 30 days, reports after 180, resolved player-report chat after 90 days and the reports after two years, the audit log after two years, and email sign-ups never confirmed or used after 30 days. The privacy page lists the same periods; change both together.

## Configuration

See `deploy/.env.example`. Required in production: `DATABASE_URL`, `SECRET_KEY`, `SMTP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Without `DATABASE_URL` the service uses an embedded PGlite (`PGLITE_DIR` for persistence, memory otherwise).

## Development

```
npm run play:dev      # :8787, embedded Postgres, fake "Dev" sign-in provider, mail at /api/dev/outbox
npm run play:test     # 28 tests: auth, 2FA, hand-off, OAuth, lobbies, tickets, quick match, billing, reports, moderation…
npm run admin -w apps/play -- create-owner you@example.com "a long password"
```
