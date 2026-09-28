# Before launch: what only you can do

The code handles what code can. These need a person, an account, a signature or a decision. Tick them off on staging first where that applies.

## Decisions

### Price
Stripe's standard card fee is 2.9% + 30¢, and prices now include tax (EU and UK law require tax-inclusive consumer prices). The settled prices are **$2/month and $12/year**:

| Plan | You receive (US, no tax) | You receive (EU, ~20% VAT) |
|---|---|---|
| $2/month | ~$1.64 | ~$1.31 |
| $12/year | ~$11.35 | ~$9.35 |

(Before Stripe Tax's own fee of about 0.5% per transaction, and extra fees on international cards.) The monthly price was raised from $1 to $2 and the yearly plan added at $12 — create it with `stripe:setup 1200`; the game and portal offer it automatically once it exists. The annual plan is where the fee stops dominating: Stripe takes 17.9% of a $2 month but only 5.4% of a $12 year.

Still worth asking Stripe support for **micropayment pricing** (about 5% + 5¢), which would lift the $2 month from ~$1.64 to ~$1.85 — but confirm the current eligibility terms rather than relying on these figures. Prices shown to players come from Stripe, so changing them needs no release.

### Store billing
The scheme is `docs/MONETIZATION.md`. **Android is built**: Google Play Billing sells the subscription in the app (prices come from Play), and the service validates every purchase with the Play Developer API before granting it; the entitlement counts only on Android. What needs a person: the Play Console product and base plans, the service account and the notification topic (docs/RELEASE-ANDROID.md, "Play Billing"). **iOS and Steam are not built yet**: iOS needs StoreKit plus App Store Server API validation as another entitlement source (the same shape as `apps/play/src/billing/play.ts`), Steam an ownership check. Until then those builds show no prices or checkout.

## Legal

- [ ] **Trademark search** for "Ozymandosis" (USPTO Trademark Search; EUIPO; UKIPO) in classes 9 and 41; consider filing once clear.
- [ ] **Counsel review** of `apps/site/public/privacy.html` and `terms.html` (both marked as drafts). They describe exactly what the software does, including retention periods, the age gate, chat handling and cloud saves.
- [ ] **Children**: accounts are 13+, under-16s get quick chat only, only an age range is stored. Confirm this posture with counsel for your markets (COPPA, GDPR Article 8, the UK Children's Code).
- [ ] **EU/UK representatives** (GDPR Art. 27) if you have no establishment there and serve players there; counsel will say.
- [ ] **Processor agreements** (DPAs): Stripe, your email provider, Linode/Akamai. All offer standard ones.
- [ ] **Tax**: activate Stripe Tax and register where required (EU OSS, UK, US states past thresholds).

## Accounts and security

- [ ] Two-factor on every account that can touch production: registrar, GitHub, Linode, Stripe, email provider, Google Cloud, Apple Developer, Steamworks.
- [ ] Registrar lock on the domain; auto-renew on.
- [ ] GitHub: branch protection on `main` (CI must pass), Dependabot alerts and security updates, secret scanning.
- [ ] `SECRET_KEY`, the backup age key and `deploy/.env` in your password manager (and the age key offline too).

## Email

- [ ] A sending provider (Postmark, Amazon SES, Mailgun…); its SMTP URL in `SMTP_URL`.
- [ ] DNS: the provider's **SPF** include, its **DKIM** keys, and **DMARC** (`v=DMARC1; p=quarantine; rua=mailto:dmarc@ozymandosis.com`), then `p=reject` once reports are clean.
- [ ] Inbound mail for `support@` and `privacy@ozymandosis.com` (the site and emails name them): a mailbox or forwarding.

## Code signing

- [ ] **Windows**: Azure Trusted Signing (or an OV certificate) for the Electron installer; otherwise SmartScreen warns every player.
- [ ] **macOS**: Apple Developer Program, a Developer ID Application certificate, and notarization (electron-builder's `mac.notarize` with an App Store Connect API key).
- [ ] **Android**: `npm run android:keygen` once, then **back the upload key up somewhere that is not this machine** (it is the one irrecoverable-in-a-hurry item); accept Play App Signing when creating the app; `npm run android:aab` for every release (docs/RELEASE-ANDROID.md).
- [ ] **iOS**: App Store Connect record, bundle ID `com.ozymandosis.game`.

## Test with real things (on staging)

Automated tests cover the code paths with stand-ins; these need the real services and devices:

- [ ] Sign in with a real Google account, a real Apple ID (including "Hide my email"), and Steam.
- [ ] Buy a membership with a real card in live mode, check the receipt and tax line, cancel it, refund it in Stripe; redeem a promo code.
- [ ] Safari on macOS and iOS: a full match, sound, fullscreen, sign-in, and the site's living title. (CI runs WebKit, but not a real iPhone.)
- [ ] A low-end and a mid-range Android phone (3 GB RAM or less; and a typical mid-range): play 15 minutes against bots at the default population, twice. Settings → Performance shows p50/p95/p99 and tier changes for each run (they also reach Admin → Performance). The two runs should agree within about 10%; if p95 is above 33 ms the quality tiers or population defaults need work before the store page claims the device (docs/PERFORMANCE.md).
- [ ] An online match between a phone on mobile data (carrier NAT) and a computer on office or hotel Wi-Fi. Every online match is relayed (D19): check the admin console or `chrome://webrtc-internals` shows a `relay` candidate pair.
- [ ] **LAN** on two real devices on one Wi-Fi, with the service unreachable (block `play.ozymandosis.com` on the router, or airplane mode + Wi-Fi): host on one, find it from the other, play to the end. Then again joining with the code only. Then on an Android API 36 build with `adb shell am compat enable RESTRICT_LOCAL_NETWORK com.ozymandosis.game` on both phones (docs/RELEASE-ANDROID.md). On iPhone, confirm the Local Network prompt appears on first host/find.
- [ ] **Play Billing** from the internal testing track (docs/RELEASE-ANDROID.md): subscribe, reinstall and restore, cancel, refund; the admin console shows each change.
- [ ] Pull the network mid-match on the guest (it should rejoin by itself) and on the host (the match continues; the host reattaches).
- [ ] A restore drill from Object Storage (OPERATIONS.md).
