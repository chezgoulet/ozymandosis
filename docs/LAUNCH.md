# Before launch: what only you can do

The code handles what code can. These need a person, an account, a signature or a decision. Tick them off on staging first where that applies.

## Decisions

### Price
Stripe's standard card fee is 2.9% + 30¢, so on a $1 payment Stripe keeps about 33¢, and prices now include tax (EU and UK law require tax-inclusive consumer prices). A $1 membership bought in France nets you roughly 50¢.

| Plan | You receive (US, no tax) | You receive (EU, ~20% VAT) |
|---|---|---|
| $1/month | ~67¢ | ~50¢ |
| $2/month | ~$1.64 | ~$1.31 |
| $10/year | ~$9.41 | ~$7.74 |

(Before Stripe Tax's own fee of about 0.5% per transaction, and extra fees on international cards.) Options, which you can combine: keep $1/month and ask Stripe support for **micropayment pricing** (about 5% + 5¢); add the yearly plan (`stripe:setup 1000`: the game and portal offer it automatically once it exists); or raise the monthly price. Prices shown to players come from Stripe, so changing them needs no release.

### Store billing
App stores and Steam require their own payment systems for digital goods. Store builds of the game therefore never show prices, checkout or code redemption, and memberships bought on the website still work in them. Apple's rule 3.1.3(b) expects content bought elsewhere to also be purchasable in the app, so before the iOS release choose one:

- add in-app purchase on iOS and Android (RevenueCat is the least work; the service's entitlements already accept more than one source), or
- ship mobile as free play with the online time limit, web membership honoured, and accept that App Review may ask for in-app purchase.

On Steam, subscriptions are awkward; the usual answer is a one-time purchase (the game or a DLC) that grants lifetime membership via Steam's ownership check.

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
- [ ] **Android**: Play App Signing; back up the upload key.
- [ ] **iOS**: App Store Connect record, bundle ID `com.ozymandosis.game`.

## Test with real things (on staging)

Automated tests cover the code paths with stand-ins; these need the real services and devices:

- [ ] Sign in with a real Google account, a real Apple ID (including "Hide my email"), and Steam.
- [ ] Buy a membership with a real card in live mode, check the receipt and tax line, cancel it, refund it in Stripe; redeem a promo code.
- [ ] Safari on macOS and iOS: a full match, sound, fullscreen, sign-in, and the site's living title. (CI runs WebKit, but not a real iPhone.)
- [ ] A low-end Android phone (3 GB RAM or less): the quality governor should hold 30+ fps; play 15 minutes.
- [ ] An online match between a phone on mobile data (carrier NAT) and a computer on office or hotel Wi-Fi; then again with **Hide my IP** on (forces TURN).
- [ ] Pull the network mid-match on the guest (it should rejoin by itself) and on the host (the match continues; the host reattaches).
- [ ] A restore drill from Object Storage (OPERATIONS.md).
