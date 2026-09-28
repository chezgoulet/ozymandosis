# Ozymandosis — the road to the stores

**Plan of record for the first platform.** Android first, because you carry
Android and because Google Play is the only store with a clock attached to a new
account. iOS and Steam are parked in the appendix — nothing in them blocks
Android.

Every number here was read from the platform's own documentation or your own
repository on **2026-09-28**, not recalled. Where a source was ambiguous I have
said so rather than papering over it.

---

## 1. The decision that gates everything: who publishes

This is the fork you asked for, and the numbers are now real.

| | Google Play — Personal | Google Play — Organization |
|---|---|---|
| Fee | US$25, one-time | US$25, one-time |
| Closed test before production | **12 testers opted in continuously for 14 days**, then apply for production access | Not required by any published rule |
| Device verification | Required (Play Console mobile app, QR flow) | Not required |
| D-U-N-S | Not required | **Required** |
| Developer name on the listing | A display name you set — "ChezGoulet" is fine | Organization name |

Both account types can monetise. A personal account is described as being for
personal, hobbyist or amateur use; an organization account for commercial
activity. Google **requires** an organization account only for financial
products, health apps, apps using the `VpnService` class, and government apps —
a game selling its own membership is none of those, so on Play this is genuinely
your choice.

**On Apple it is not a choice.** Apple's Individual enrolment displays *your
personal legal name as the seller name on the App Store*, and a sole proprietor
must enrol as an individual. To have **ChezGoulet** appear as the seller you need
Organization enrolment, which requires all of: a legal entity that can enter
contracts with Apple (no DBAs or trade names), a D-U-N-S number, a work email on
the organization's domain, and a publicly available, functional website on that
domain. Apple verifies each of those and may ask for notarized documents.

So the fork resolves like this:

- **If ChezGoulet is the publisher name** — and you told me it is — then Apple
  forces an entity eventually, and Play's Organization account becomes the
  consistent choice. It also skips the 12-tester gate.
- **The cost of the entity** is a D-U-N-S number (free in most jurisdictions,
  lead time not under your control) and the legal/tax work of forming or
  designating one. **That is your cross-border accountant's call, not mine** —
  it is the Gate 0 you already treat it as.
- **The cost of the personal route** is not money. It is **twelve real people
  who stay opted in for fourteen continuous days** and then a human at Google
  reading your testing summary. That is the price, and it is measured in weeks
  and favours.

My read: if the entity is going to exist anyway, the time to make that decision
is now, before you register, because converting an Apple individual account to
an organization means contacting Apple and waiting. I would not register either
account until your accountant has answered.

---

## 2. The Android obstacle that has already expired

Google Play requires **new apps and app updates to target Android 16 (API level
36) or higher** as of **31 August 2026** — four weeks ago. This is not a
future deadline; a release uploaded today that targets API 35 or below is
rejected.

Your repository today:

```
android/variables.gradle
    minSdkVersion     = 22
    compileSdkVersion = 34      <-- must become 36
    targetSdkVersion  = 34      <-- must become 36
android/build.gradle
    com.android.tools.build:gradle:8.2.1
gradle-wrapper.properties
    gradle-8.2.1-all
```

**Android Gradle Plugin 8.2.1 and Gradle 8.2.1 are from late 2023 and cannot
compile against API 36.** So this is not a one-line version bump: it drags the
AGP version, the Gradle wrapper, and the JDK forward together. The exact minimum
AGP for API 36 should be read off Android's release notes at the moment you do
it, rather than taken from memory — including from mine.

Note also that `java` is not on the default PATH for a non-interactive shell on
that host, though `docs/DECISIONS.md` D7 says a JDK 17 is present and a debug
APK has been built. Worth pinning down, because the upgrade will need it.

Other things the repository does not yet have, all of which block a release:

- **No release signing.** `android/app/build.gradle` has no `signingConfig`, and
  `npm run android:apk` runs `assembleDebug` only. New apps must ship an
  **Android App Bundle (AAB)**; APKs are not accepted for new apps. You will
  create a keystore, sign a release bundle, and accept the **Play App Signing**
  terms at app creation.
- **Cleartext is enabled.** `capacitor.config.json` sets `cleartext: true` and
  `allowMixedContent: true`. Those are development conveniences and must come
  out before a networked game with accounts and chat ships.
- **Mobile performance has never been measured on a real phone.** Your own
  `docs/DELIVERY.md` says it plainly: *"Emulated... Not measured on real phones.
  The emulation throttles CPU only; the GPU is still the desktop card."* This is
  the one open claim that no amount of store paperwork fixes.

---

## 3. The Android checklist, in order

1. **Settle the entity question.** (Section 1.)
2. **Read the target-API requirement page again** on the day you start. It moves.
3. **Upgrade the Android project** to `compileSdk`/`targetSdk` 36, with the AGP,
   Gradle wrapper and JDK that requires.
4. **Create a release keystore, wire a `signingConfig`, add a `bundleRelease`
   path** to `package.json`. Back the keystore up somewhere that is not the
   Thelio — losing it is the classic unrecoverable mistake, and Play App Signing
   is what saves you from it.
5. **Turn off cleartext and mixed content**, and confirm the app talks HTTPS
   only.
6. **Measure on a real phone.** Mid-range, not flagship. This is the number that
   decides your population-cap defaults and whether the 60 fps claim survives
   contact with an actual device.
7. **Play Console**: register the account ($25), verify identity, and — if
   personal — verify a device.
8. **Create the app**, accept the policies, the US export declaration and the
   Play App Signing terms.
9. **App content declarations**: privacy policy URL (mandatory even for apps
   that collect nothing), ads declaration, app access instructions, content
   rating questionnaire (IARC), **Data safety form**, and **data deletion** —
   because users can create accounts you need *both* an in-app deletion path and
   a public web link for deletion requests.
10. **Store listing**: title, short and full description, icon, feature graphic,
    phone screenshots.
11. **Closed test** — 12 testers, 14 continuous days, if personal accounts apply
    to you. While that gate is unmet, Production and Pre-registration are
    disabled in the Console.
12. **Apply for production access**, answering the questions about your testing
    and summarising the feedback you received.
13. **Production release** with a staged rollout. Review is quoted as *"a few
    hours or up to seven days (or longer in exceptional cases)."* There is no
    published guarantee, and no separate first-submission figure.

---

## 4. The scheme

**Settled, and recorded in the repository** — see `docs/MONETIZATION.md` on the
`ozymandosis` branch, commit `a97138a` and its update. That file is the decision
of record; this plan does not restate it, so the two cannot drift.

What it means for the work in this document:

- **The mobile subscription must be a real in-app purchase** (Apple 3.1.1,
  Google Play Billing). That is an integration that does not exist yet and
  belongs in the Android scope, not after it.
- **The Steam offering is a one-time DLC**, which sidesteps Valve's unsupported
  recurring subscriptions and the fact that a recurring subscription's price can
  never be raised.
- **Store-side purchase validation becomes mandatory**, because entitlements are
  per platform and bound to accounts. Without it the binding is decorative.
- **`FREE_MATCH_MINUTES` becomes a per-day match allowance**, and the signed
  ticket carries a count rather than an expiry.
- **Post-launch revenue is copies and multiplayer time only.** Content features
  are retention investments, not revenue events — which is the lens for ordering
  the roadmap.

## 5. What I still need from you

1. ~~The monetization scheme.~~ **Answered** — see section 4.
2. **The entity decision**, once your accountant has spoken.
3. **The feature ideas**, for the roadmap page.
4. **Whether the roadmap is a promise or a sketch.** Very different pages.
---

# Appendix — parked, not scheduled

Nothing here blocks Android. Recorded so the work is not re-done later.

## iOS

- **US$99 per year**, recurring. Enrolment must be Individual or Organization;
  the publisher-name constraint is in Section 1.
- **Requires macOS with Xcode.** Upload tooling (Xcode, Transporter, `altool`)
  is macOS-only. You do not need to own a Mac — Codemagic's free tier gives 500
  macOS M2 build minutes a month with code signing driven by an App Store
  Connect API key, and GitHub Actions macOS runners cost $0.062/min after about
  200 free minutes. Xcode Cloud's included 25 hours/month look better but are
  configured *in Xcode*, so they presuppose the Mac they appear to replace.
- **Build requirement in force since 28 April 2026:** uploads must be built with
  Xcode 26 or later against the iOS 26 SDK. From **April 2027**, the iOS 27 SDK.
- **Guideline 4.2 Minimum Functionality** is the primary rejection risk for a
  Capacitor app: it must not read as a repackaged website. This is a content and
  interaction problem, not a packaging one.
- **Guideline 2.5.2** forbids downloading code that changes features. Ozymandosis
  bundles its scripts with no remote script tags, so it is compliant today —
  keep it that way, and do not ship the game logic by swapping bundles.
- **Guideline 4.8** means that because you offer Google, Discord, GitHub and
  Steam sign-in, you must also offer an equivalent login meeting three criteria
  (name and email only, private email relay, no ad-tracking). Apple's own
  sign-in is the canonical answer and your service already supports it.
- **Guideline 5.1.1(v)**: in-app account deletion is mandatory.
- **Guideline 1.2** applies to chat: filtering, reporting, blocking and
  published contact details. Random or anonymous chat is removed without notice.
- **EU DSA trader status** must be declared and verified, or the app is removed
  from the EU storefront.
- Review: Apple states under 24 hours for 90% of submissions. TestFlight external
  builds are reviewed, and every build expires after 90 days.

## Steam

- **US$100 per app**, non-refundable, recouped once the product reaches $1,000
  adjusted gross revenue.
- **21-day wait** after paying the fee before you can release, plus the store
  page must be public as *Coming Soon* for **at least 14 days** before launch,
  plus 3–5 business days each for store-page review and build review (submit at
  least 7 business days ahead). Realistically: **about five weeks from paying to
  launch**, minimum.
- **Required assets, exact:** header capsule 920×430, small capsule 462×174, main
  capsule 1232×706, vertical capsule 748×896, at least five gameplay screenshots
  at 1920×1080, library capsule 600×900, library hero 3840×1240, and a
  **trailer, which is mandatory** and must finish encoding before you can
  release.
- **A content survey is required before review**, including a Generative AI
  section — worth noting since an agent has been writing this code.
- Germany requires a valid age rating; without one the game is hidden there.
- **In-game purchases must use the Steam Wallet.** A membership billed through
  your own Stripe on Steam is the main policy risk for this title.
- **Electron is not explicitly greenlit anywhere in Valve's documentation.** I
  could not verify it either way. Many games ship that way, but it is an
  assumption to confirm with Steamworks support before committing.
- Valve classifies revenue-share payments as **royalties**, which is a tax
  classification question for your accountant, not a store question.


---

# Appendix B — feature wishlist: effort notes and follow-through

Internal notes for the published wishlist (`docs/ROADMAP.md`). Not for the
website.

**Naming.** `leviathan` is already the apex *chassis* — 900 HP, 8 slots,
`hero: true`, "Apex spawn. One per colony", a unit your own colony commands. It
is also the hardest bot difficulty, two achievements and a player title. The
proposed event is its opposite (a threat that eats your creatures), so the word
would be inverted; **Behemoth** is the canonical other half of the pair and is
free. Working name, not fixed.

**Behemoths.** A new entity class: own AI, own atlases, multiple kinds, and it
interacts with the food web. The expensive part is not the art, it is that a
random event must be **seeded from the in-sim RNG and carried in the saved
config as a match option** — the same reasoning as D6's population cap — or it
desyncs multiplayer and breaks replay. Configurable means a match option, not a
server decision and not wall-clock.

**Capabilities.** The effect API already exposes `w.cloud`, `w.shot`,
`w.damage`, `w.buff`, `w.spawnUnit`, `w.event`. Poison clouds, bio bombs, mines,
tendril constriction and vampiric drain are therefore close to *content rows in
`js/data/specials.js`*, and the existing gate ("every ability, power and powerup
has an observable effect") already proves them. **Parasites are the exception** —
persistent attachment state plus an economy interaction is new machinery.

**Structures.** `js/data/` contains only `chassis`, `organs`, `specials` and
`techs`. Structures have **no content table** — they are handled in the sim
directly. So "more building types" starts by creating the table that made organs
and specials cheap. Do that first; everything after is rows.

**Organs.** The grid is 5 classes x 6 forms x 4 tiers, and the GL path bakes
30 organs x 4 tiers x 8 frames into an atlas at startup. New forms are content
plus bake time, not new architecture.

**The invisible-content trap.** `js/data/techs.js` carries per-persona
`aiResearch` lists. Content absent from every bot's research order is content a
**single player will never encounter**. Every new organ and power needs an entry
somewhere, or it only exists in multiplayer.

**Terrain.** Interacts with the existing Burn/Flood/Smash transition chains, the
flow fields and mapgen, at every map size. Seeded, deterministic, and it has to
keep the B-Rule (no state change is a single-frame swap).

**Campaign.** The largest item on the list — larger than the Behemoths. Needs a
mission/scenario format, bespoke maps, narrative, and progression across
missions. It is also the item where "all future content" costs the most: the
most expensive content the project will ever produce, earning nothing beyond the
$1 already paid. Not a reason to skip it; a reason to schedule it last and
decide it deliberately.

**Referrals.** Rails already exist — `apps/play/src/cli.ts` has
`grant <email|name> <days>` for complimentary membership and
`002_promo_codes.sql` backs promo codes. **Pay the reward on the referred
player's first payment, never on signup**, or two accounts refer each other
indefinitely.

**Leaderboards.** The sim is deterministic, so scores can be **verified by replay
rather than trusted**. Almost no RTS can do that. It is a genuine advantage and
worth building the leaderboard around rather than bolting on.

**Discord (the "community server").** Not engineering — no in-game work at all.
But it is an ongoing moderation obligation, and Discord's minimum age is 13, so
the in-game link must not be shown to accounts below that. The service already
has an age gate; wire the two together.

**Every item inherits the repo's gates.** Content is done when `npm test` proves
every organ changes stats and every special has an observable effect, and when
`npm run test:perf` still passes.

---

# Appendix C — correction: the Android cleartext advice was wrong

The audit proposed scoping cleartext to private address ranges with
`network_security_config.xml`. **That does not work.** Android's network
security config matches *hostnames*, not CIDR ranges — there is no way to write
"permit cleartext for `192.168.0.0/16`". A config that looks like it does is
matching a literal string, not a range.

The real options, in order of how much they change:

1. **Keep cleartext permitted** — which is what `server.cleartext: true` in
   `capacitor.config.json` produces. Google Play does not prohibit cleartext;
   it is a declared posture, not a policy breach. This is the status quo.
2. **Remove the need for it.** LAN play could run over WebRTC DataChannels —
   the game already has WebRTC, and a DataChannel to a peer on the same network
   needs no cleartext exception at all — or over `wss://` with a locally
   trusted certificate. This is the only version that removes the exception
   rather than declaring it.
3. **On iOS the same decision appears in different clothes**: a `ws://`
   connection needs an App Transport Security exception, and App Review reads
   and questions those. So this is a two-platform decision, not an Android
   hardening chore.

**Recommendation:** leave cleartext on for now — LAN play works and Play
permits it — and treat "LAN play with no cleartext exception" as a genuine
feature decision for later. The defect the audit actually found was the
hardcoded address, and that is fixed.

## Verification note

`docs/LAUNCH.md` still lists the real-device checks, and the low-end Android
frame-rate test remains the one claim no store process can substitute for.
