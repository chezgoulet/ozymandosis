# Before launch: what only you can do

The code handles what code can. These need a person, an account, a signature or a decision.
Tick them off on an on-demand staging box first where that applies (see `DEPLOY.md`).

**Current scheme:** the app is free, distributed through Obtainium and F-Droid. The only paid
product is worldwide online multiplayer, bought on the website through Stripe. There are no
store sales, no $1 purchase and no platform billing. `docs/MONETIZATION.md` is the scheme of
record.

## Pricing and distribution

- [ ] **App free.** Build and publish the signed Android APK to GitHub Releases; Obtainium
  carries it. Submit the app to F-Droid (`docs/fdroiddata/`).
- [ ] **No store accounts.** No Google Play, App Store or Steam listing; no in-app purchase;
  no store receipt validation.
- [ ] **Stripe products**: $2/month and $12/year. `npm run admin -- stripe:setup 1200`
  creates them; set `STRIPE_PRICE_ID` and `STRIPE_PRICE_ID_YEARLY` if you create your own.
- [ ] **`deploy/.env`:** `WEB_BILLING=1`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `REQUIRE_STORE_CLIENT=0`. The service refuses to boot with web billing on and the Stripe
  keys missing.
- [ ] **Stripe Tax** on; registrations where required (EU OSS, UK, US states past thresholds).
- [ ] Customer portal: allow cancel, switch plans and update payment methods.

## Legal

- [ ] **Trademark search** for "Ozymandosis" (USPTO, EUIPO, UKIPO) in classes 9 and 41;
  consider filing once clear.
- [ ] **Counsel review** of `terms.html` and `privacy.html` in `chezgoulet/ozymandosis-site`.
  They must name **Franco Perdu LLC** as the service operator and **Chez Goulet LLC** as the game
  licensor.
- [ ] **AGPL-3.0**: the game is AGPL-3.0-only; the source offer is the public repository. If
  the play service is modified, the modified source must be offered to users.
- [ ] **Children**: accounts are 13+, under-16s get quick chat only, only an age range is
  stored. Confirm with counsel for your markets (COPPA, GDPR Article 8, UK Children's Code).
- [ ] **EU/UK representatives** (GDPR Art. 27) if you have no establishment there and serve
  players there; counsel will say.
- [ ] **Processor agreements** (DPAs): Stripe, the email provider, Linode/Akamai.
- [ ] **Tax**: Stripe Tax; registrations where required.

## Accounts and security

- [ ] Two-factor on every account that can touch production: registrar, GitHub, Linode,
  Stripe, email provider. No store accounts.
- [ ] Registrar lock on the domain; auto-renew on.
- [ ] GitHub: branch protection on `main` (CI must pass), Dependabot alerts and security
  updates, secret scanning. **Partly done (2026-11-16):** secret scanning, push protection,
  Dependabot alerts and security updates, branch protection and `SECURITY.md` are all on.
  **The "CI must pass" half is not enforced** — requiring it today would only gate on `test`,
  because the browser suite runs on push rather than on pull requests, and that gap is what let a
  regression through. Either run browsers on dependency PRs first, or accept a human merge.
- [ ] `SECRET_KEY`, the backup age key and `deploy/.env` in the password manager (and the age
  key offline too).

## Email

- [ ] A sending provider (Postmark, Amazon SES, Mailgun…); its SMTP URL in `SMTP_URL`.
- [ ] DNS: the provider's **SPF** include, its **DKIM** keys, and **DMARC**
  (`v=DMARC1; p=quarantine; rua=mailto:dmarc@ozymandosis.com`), then `p=reject` once reports
  are clean.
- [ ] Inbound mail for `support@` and `privacy@ozymandosis.com`: a mailbox or forwarding.

## Code signing

- [ ] **Android**: `npm run android:keygen` once, then back the upload/release key up
  somewhere that is not this machine. It is the one irrecoverable item.
- [ ] `npm run android:apk` for the Obtainium release. F-Droid builds and signs its own
  version; keep the metadata in `docs/fdroiddata/` current.
- [ ] No Windows, macOS, iOS or Steam signing in the current distribution.

## Test with real things (on an on-demand staging box)

Automated tests cover the code paths with stand-ins; these need the real services and devices:

- [ ] Sign in with the providers you actually enable (email; Google/Apple/Steam only if the
  credentials are set). The app must work without a Google account.
- [ ] Buy a membership with a real card in live mode, check the receipt and tax line, cancel
  it, refund it in Stripe; redeem a promo code.
- [ ] A low-end and a mid-range Android phone (3 GB RAM or less; and a typical mid-range):
  play 15 minutes against bots at the default population, twice. Settings → Performance shows
  p50/p95/p99 and tier changes for each run. The two runs should agree within about 10%; if
  p95 is above 33 ms, fix the quality tiers or population defaults before release.
- [ ] Install the signed APK through Obtainium, not a debug build; confirm the release
  signature and that the app opens.
- [ ] An online match between a phone on mobile data (carrier NAT) and a computer on office or
  hotel Wi-Fi. Every online match is relayed; check the admin console or
  `chrome://webrtc-internals` shows a `relay` candidate pair.
- [ ] **LAN** on two real devices on one Wi-Fi, with the service unreachable: host on one,
  find it from the other, play to the end. Then again joining with the code only.
- [ ] Pull the network mid-match on the guest (it should rejoin by itself) and on the host
  (the match continues; the host reattaches).
- [ ] A restore drill from Object Storage (`OPERATIONS.md`).
