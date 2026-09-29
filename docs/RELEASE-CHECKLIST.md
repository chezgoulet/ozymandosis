# Release checklist — from the signed bundle to production

`LAUNCH.md` is the canonical list of what a person must do, by kind.
`WORK-ORDER-FIRST-RELEASE.md` is what the code needed. **This is the same material
ordered by what blocks what**, so it can be worked top to bottom.

**[you]** only you can · **[me]** I will · **[both]** something from you, then me

---

## Where you already are — do not redo any of this

- Google's **identity verification passed** (the gate everything sat behind).
- The **app record exists** in Play Console, package `com.ozymandosis.game`.
- The **upload key exists** at `~/.ozymandosis/upload-keystore.jks`, backed up
  off-machine and checked to open. Play App Signing is confirmed.
- A **signed bundle** exists: `app-release.aab`, 7.2 MB, signed
  `CN=Ozymandosis upload key`, SHA-256 `C5:43:05:…:80:86`, versionCode 500.
- **CI is green on the House runner** and `testing` holds the current tip.
- The **site is live** over HTTPS: `ozymandosis.com`, with `/privacy` and
  `/terms` reachable.
- The **data answers are drafted** — `docs/PLAY-DECLARATIONS.md`.
- The **data inventory is machine-checked** — `apps/play/test/inventory.test.ts`
  fails if it drifts from the code.

---

## The shape of the clock

```
closed-test release published
        -> Google review
        -> 12 testers opted in continuously
        -> 14 continuous days            <- cannot be compressed, bought or automated
        -> apply for production access
        -> Google review of the application
        -> production
```

Google's own wording: *"You can start a closed test after completing your app
setup."* And: *"At least 12 testers must be opted in to your closed test when you
apply for production access, and they must have been opted in continuously for the
preceding 14 days."* Note **internal testing does not count** toward it.

Everything below is either making that clock *startable*, or work that runs beside it.

---

## Three things that could cost you the model, so check them first

**1. Is the app set as PAID?** A free app on Google Play **cannot become a paid
app.** If the app record was created as free, the $1 purchase cannot be turned on
later and the whole monetization ruling is broken — the recovery is an in-app
purchase rather than a price, or a new app record. **Verify in Pricing and
distribution that it is priced, before publishing anything.** Also confirm the app
is available in **the countries your testers live in** — a tester outside the
distribution list cannot install it and cannot count.

**2. Testers on a closed track must BUY the app.** Google's own guidance:
*"if you're testing a paid app using an open or closed test, testers still need to
purchase it. If you're testing a paid app using an internal test, testers can
install your app for free."* So all twelve of your closed testers need a payment
method and must each pay $1 — about $12 total, but this is the step that quietly
sinks closed tests, because a tester who cannot pay cannot count. **Tell them
up front.**

**3. The web deletion-request URL does not exist.** Play requires an app with
accounts to offer **both** in-app deletion (done) **and** a publicly reachable web
link for deletion requests. The only web path today is the account page at
`play.ozymandosis.com`, and that hostname does not resolve. So **App content cannot
be completed** until it does, and the release cannot publish. Steps 1–3 below fix it.

---

## Phase 1 — Make the clock startable

- [ ] **[you]** Sign up **Purelymail** (the mailboxes) and **Resend** (sending).
      `privacy@ozymandosis.com` must be real: the privacy policy names it, and the
      stores test that it works.
- [ ] **[me]** Then I write **SPF, DKIM, DMARC and MX** into the Linode zone and
      create `support@` and `privacy@`.
- [ ] **[me]** Add **`/delete-account`** to the live site — the in-app steps, and an
      email route for people who no longer have the app. **This unblocks App content.**
- [ ] **[you]** Complete **App content** in the Console. Every field, because the
      release will not publish without them: privacy policy URL, **data safety**,
      **content rating questionnaire**, **target audience** (13+, and be ready to
      defend it — the content is child-appealing, but no under-13 experience
      exists), **ads** (none), **app access** (create a reviewer account; online
      play needs one, single-player and LAN do not), and the **deletion URL**.
      The answers are in `docs/PLAY-DECLARATIONS.md`.
- [ ] **[both]** Complete the **store listing** — title, short and full
      description, app icon **512×512**, feature graphic **1024×500**, at least
      **two screenshots** per device type, app category and contact details. I can
      write the copy and produce the graphics from the game; you approve them.
- [ ] **[you]** Complete the **payments profile / merchant account** in Play
      Console. You cannot sell a $1 app — or receive membership revenue — without
      it, and verification of a new profile takes days. This is easy to overlook
      and it sits directly on the critical path.
- [ ] **[both]** **Deploy the service to `play.ozymandosis.com`.** The closed test
      is meant to exercise the game, and without the service there is no sign-in
      and no online play — the 14 days are calendar you cannot get back, so do not
      spend them on a crippled build. The chain is:
  - [ ] **[you]** Create the **two GitHub environments**, `staging` and
        `production`, each with `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`,
        `DEPLOY_KNOWN_HOSTS`. **This is the single gate on all deploy automation** —
        the pipeline is written and no-ops by design until the secrets exist.
  - [ ] **[you]** **Rebuild the Linode box** from a fresh `linode/ubuntu26.04`
        image, and decide the size — it is idle today and nothing is attached.
  - [ ] **[me]** Bootstrap it as **one scripted command**: Docker, a clone at
        `~/ozymandosis`, `deploy/.env`, a swap file, memory caps.
  - [ ] **[me]** Add the `play.ozymandosis.com` DNS record and get **TLS** — the
        app talks to it over HTTPS/WSS, and Play Integrity and the billing
        webhook both need a real certificate.
  - [ ] **[both]** Prove the deploy pipeline end to end: promote `testing` to
        `main` and watch it back up, deploy, health-check and roll back on its own.

## Phase 2 — The build that goes out

- [ ] **[me]** Set up **Play Billing**: subscription `ozymandosis_membership` with
      base plans `monthly` ($2) and `annual` ($12); a Google Cloud service account
      invited with *View financial data* and *Manage orders and subscriptions*; and
      real-time developer notifications through Pub/Sub to
      `/api/billing/play/rtdn`. Then **[you]** add **license testers** so test
      purchases renew every few minutes — that is how renewals and expiry get
      exercised in a day rather than a month.
- [ ] **[both]** Upload the signed AAB to **internal testing** and smoke it on your
      own phone first. **Installs are free on internal**, so this is your own
      ten-minute check before anyone else is involved: does it install, launch,
      sign in, play a match.
- [ ] **[you]** **Recruit fifteen**, not twelve. The requirement is twelve opted in
      *continuously* for fourteen days, and a single lapse drops you under the
      line. The buffer is the difference between a fortnight of progress and
      starting over. Brief them that they must **buy the app** and stay opted in.
- [ ] **[you]** Move the bundle to a **closed test track** and publish the release.
      It goes through Google review before testers can download it — budget days,
      not hours, for a first submission.
- [ ] **[you]** Testers **opt in and play**. Send them the Play Store URL directly —
      a closed test is not findable by search. Ask each to leave **feedback through
      Play's private feedback channel**, because the production application asks
      what feedback you received. **Insufficient tester engagement is a stated
      reason for refusing production access.**
- [ ] **Fourteen continuous days.** Watch that nobody drops out.
- [ ] **[you]** **Apply for production access**, answering the questions about your
      testing and your app's readiness. A human reads it.

## Phase 3 — Build the case the production application rests on

These belong to the 14 days, not after them. They are also the evidence that the
application and the store claims stand on.

- [ ] **[you]** **Fifteen minutes on a mid-range Android.** The frame rate is still
      the largest unverified claim in the project and the cheapest test with the
      biggest consequences. Settings → Performance shows p50/p95/p99 per run. **If
      a mid-range phone cannot hold 30 fps, the plan changes rather than the code.**
- [ ] **[you]** **Two real phones on LAN**, full match, service unreachable. Then the
      same joining only with the code the host shows. Then on an API 36 build with
      `adb shell am compat enable RESTRICT_LOCAL_NETWORK com.ozymandosis.game` —
      the clause that stops local-network permissions becoming next year's emergency.
- [ ] **[you]** **Play Billing on the internal track**, with a real card: subscribe,
      reinstall and restore, cancel, refund. The admin console should show each change.
- [ ] **[you]** **Pull the network mid-match**, on the guest and on the host.
- [ ] **[me]** A **restore drill** from Object Storage, run for real rather than
      asserted (`OPERATIONS.md`).
- [ ] **[you]** **Counsel review** of the privacy policy and terms — both are still
      marked as drafts and both are public.
- [ ] **[you]** **Trademark search** for "Ozymandosis" (classes 9 and 41) before the
      name is public on a store.
- [ ] **[you]** **Two-factor** on every account that can touch production: registrar,
      GitHub, Linode, Stripe, mail, Google Cloud, Apple, Steamworks. Registrar lock
      and auto-renew on the domain.
- [ ] **[you]** **Branch protection on `main`**, Dependabot, secret scanning. Free,
      small, and it stops a mistake being permanent.

## Phase 4 — The other platforms, and their clocks

Neither blocks Android. Both have lead times worth starting early.

- [ ] **[both]** **iOS.** ⚠️ *The iOS code has never been compiled — there is no
      Xcode on this side.* It needs Codemagic's free tier: **[you]** create the
      account, **[me]** wire the build. Then an App Store Connect record for
      `com.ozymandosis.game`, and the Apple Developer Program at $99/year. **The
      remaining hole is StoreKit**: Apple's rules expect the membership to be
      buyable inside the app, and that is not built.
- [ ] **[you]** **Steam.** Steam Direct's **$100 per app** starts a **21-day** wait,
      and the page must be publicly *Coming Soon* for **two weeks** before launch —
      **about five weeks end to end, the longest lead time in the project.** Ship
      **Windows** first and let Proton cover Linux and Deck: it is the cheapest
      route and it is not a compromise. Windows needs code signing, or SmartScreen
      warns every player.
- [ ] **[you]** **Skip native Linux unless pride demands it.** Nothing else waits
      on it.

---

## What I can do with nothing from you

- The store listing copy, and the icon, feature graphic and screenshots rendered
  from the game.
- The `/delete-account` page, ready the moment Purelymail lands.
- The rebuild-and-bootstrap as a single scripted command.
- The Codemagic wiring for iOS.
- Anything else you ask for in the code, on the same gate as everything else:
  green CI on the House runner, then merged.

## What I cannot do, and will not pretend to

The accounts, the signatures, the payments, the hardware, the lawyer, and the
twelve people who must stay opted in for a fortnight. The twelve are the only item
here that cannot be bought or automated — and the only one that can put the launch
back by a fortnight on its own.
