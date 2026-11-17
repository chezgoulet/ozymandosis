# Release checklist — from the tree to players

`LAUNCH.md` is the canonical list of what a person must do, by kind. **This is the same material
ordered by what blocks what**, so it can be worked top to bottom.

**[you]** only you can · **[me]** I will · **[both]** something from you, then me

**Rewritten 2026-11-16** for the current scheme (D22, D23): the app is **free**, distributed through
**Obtainium and F-Droid**, the only paid product is **website membership through Stripe**, and
**Android is the only platform**.

What the previous version of this file described, and why it is gone:

- **The Google Play closed-test clock** — paid app, twelve testers opted in continuously for
  fourteen days, production access, Play Billing. D22 retired the Play listing; the app is free and
  sold nowhere. None of that clock exists now.
- **iOS** — D23 deleted the project.
- **Steam** — no listing under D22.

If you are looking for those steps they are not lost; they are in git history at `v0.5.3` and in
`docs/MONETIZATION.md` under the retired scheme. They are not part of launch.

---

## Where you already are — do not redo any of this

Verified 2026-11-16:

- **The site is live over HTTPS**: `ozymandosis.com`, and `/privacy` and `/terms` both answer 200.
- **The service is deployed and answering**: `play.ozymandosis.com/healthz` 200, running `82b6524`.
  Deploy is a `workflow_dispatch` of `deploy.yml` (or a release tag) — **not** a push to `main`.
  The `DEPLOY_*` environment secrets already work; the rail has been used.
- **A signed APK already ships.** Release `v0.5.3` carries `ozymandosis-android-v0.5.3.apk` plus a
  `.sha256`, and the release workflow verifies it with `apksigner`. That means the Android signing
  secrets are configured — inferred from the artifact, since CI never prints them. The distribution
  rail is proven; it needs a new tag, not new plumbing.
- **CI is green** on `main` and `testing`: `test`, `images`, `android` (22 and 24) and all three
  browsers.
- **The data inventory is machine-checked** — `apps/play/test/inventory.test.ts` fails if the
  document drifts from the schema.
- **GitHub guards are on**: secret scanning, push protection, Dependabot alerts and updates, branch
  protection, private vulnerability reporting, `SECURITY.md`. One gap: **"CI must pass" is not
  enforced**, because the browser suite runs on push rather than on pull requests — see the note in
  `LAUNCH.md`.
- **F-Droid metadata is drafted**: `docs/fdroiddata/com.ozymandosis.game.yml`.

---

## The shape of the clock

There is no fourteen-day tester window any more. What cannot be compressed now:

```
Stripe account verification ....... days        (blocks every payment test)
F-Droid review of a new app ....... days-weeks  (volunteer-run; the slowest first submission)
trademark search + counsel review . weeks       (slowest if counsel is slow)
everything else ................... hours
```

The old checklist's "cannot be bought or automated" item was twelve testers. It is now
**F-Droid's review queue**, and it is somebody else's calendar.

---

## Three things that could sink it — check them first

**1. Email is not optional, and nothing else works without it.** An account cannot be verified
without a link, and password reset is the same link. `SMTP_URL` is already a hard boot requirement
in production, so the service refuses to start without one — which means a wrong SMTP URL is not a
degraded feature, it is a dead service or an unverifiable account. **Fix this first.**

**2. Membership is the only revenue and Stripe is the only rail.** Tax-inclusive prices (`$2/$12`)
are sold into every jurisdiction Stripe Tax will register you for. If registrations are missing you
are collecting money in a place you are not registered to collect it. That is a bookkeeping problem
that compounds, not a config detail.

**3. Lose the Android keystore and you lose the package identity.** Obtainium and F-Droid pin the
signing certificate; a new key is a new app to both, and there is no migration path that keeps
existing installs updating. The key exists (the v0.5.3 APK proves it) — confirm it is backed up
off-machine, twice, before you depend on it.

---

## Phase 1 — Email, because everything sits on it

- [ ] **[you]** Choose a sending provider (Postmark, SES, Mailgun, Fastmail…). Check it is not
      greylisted for the volume you expect.
- [ ] **[both]** Put its SMTP URL in `deploy/.env` as `SMTP_URL`, then deploy.
- [ ] **[me]** Write **SPF, DKIM, DMARC and MX** into the Linode zone once you have the provider's
      records.
- [ ] **[you]** Make `support@` and `privacy@ozymandosis.com` real. The privacy policy already
      names `privacy@`; an address that bounces is a broken promise in a public document.
- [ ] **[me]** Send a real message to an outside mailbox and check the headers land clean
      (SPF pass, DKIM pass, DMARC pass) — not just that the request returned 200.

## Phase 2 — Money

- [ ] **[you]** Complete Stripe account verification (business details, bank account). Lead time:
      days. Nothing below works until it clears.
- [ ] **[me]** `npm run admin -- stripe:setup 1200` — creates the product and the $2/month and
      $12/year prices.
- [ ] **[you]** Activate **Stripe Tax** and add your registrations. Prices are tax-inclusive, so
      this is what stops you selling into a jurisdiction you are not registered in.
- [ ] **[you]** Enable the **customer portal**: cancel, switch plan, update payment method. Without
      it a member has no way to stop paying.
- [ ] **[both]** Buy a membership with a **real card in live mode**: check the receipt, the tax
      line, then cancel and confirm access lapses at period end rather than at once.
- [ ] **[both]** Confirm the gate itself: one free match per rolling 24 hours on a fresh account,
      then the allowance message, then unlimited as a member.

## Phase 3 — The artifact players install

- [ ] **[you]** Confirm the Android keystore is backed up off-machine and that you can open it.
      If it is not: `npm run android:keygen` once, then back it up **before** continuing.
- [ ] **[me]** Bump the version, tag `vX.Y.Z`, and let the release workflow build, sign, verify and
      attach the APK plus its sha256.
- [ ] **[you]** Install through **Obtainium**, not a debug build, and confirm the release verifies
      and updates over the previous install.
- [ ] **[both]** Submit `docs/fdroiddata/com.ozymandosis.game.yml` to F-Droid as a merge request,
      and answer the review. This is the long pole — start it as early as the APK is installable.

## Phase 4 — Real devices, and the claims the release rests on

- [ ] **[you]** **A mid-range phone and a 3 GB one.** Settings → Performance gives p50/p95/p99 per
      run. If a mid-range device cannot hold 30 fps, **the plan changes, not the code** — this is
      still the largest unverified claim in the project.
- [ ] **[you]** **Two phones on one Wi-Fi, service unreachable**: host on one, join on the other,
      full match. Then join by the code the host shows. Then on an API 36 build with
      `adb shell am compat enable RESTRICT_LOCAL_NETWORK com.ozymandosis.game`.
- [ ] **[you]** **Online match across networks**: phone on mobile data (carrier NAT) against a
      computer on office or café Wi-Fi. This is the case a single-network test never covers.
- [ ] **[you]** **Pull the network mid-match**, on the guest and then on the host: the guest should
      rejoin by itself; the host's guests should see the match end cleanly rather than hang.
- [ ] **[me]** A **restore drill** from Object Storage, run for real rather than asserted
      (`OPERATIONS.md`).

## Phase 5 — Legal and hygiene

- [ ] **[you]** **Counsel review** of `/privacy` and `/terms`. Both are public and both are still
      marked as drafts.
- [ ] **[you]** **Trademark search** for "Ozymandosis" (USPTO, EUIPO, UKIPO), classes 9 and 41,
      before the name is distributed more widely.
- [ ] **[you]** **Two-factor** on every account that can touch production: registrar, GitHub,
      Linode, Stripe, mail, Cloudflare. Registrar lock and auto-renew on the domain.
- [ ] **[you]** `SECRET_KEY`, the backup age key and `deploy/.env` into the password manager, with
      the age key also offline.
- [ ] **[you]** Decide whether **EU/UK Art. 27 representation** and **processor DPAs** (Stripe, the
      email provider, Linode) apply to you. If they do, they are paperwork with a lead time.

---

## What I can do with nothing from you

- The F-Droid merge request text and its answers once review starts.
- Release notes for any tag (`tools/release-notes.cjs` generates them).
- The DNS records, written and ready to paste, once you name the mail provider.
- Anything else in the code, on the same gate as everything else: green CI, then merged.

## What I cannot do, and will not pretend to

The accounts, the signatures, the payments, the hardware, the lawyer, and F-Droid's review queue.
The queue is the only item here that can put the launch back by weeks on its own — and the only one
where the work is answering somebody else's questions rather than building anything.
