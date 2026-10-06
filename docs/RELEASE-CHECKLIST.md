# Checklist to release

**This document is the sequence.** `LAUNCH.md` is the canonical list of things a
person has to do, grouped by kind; `WORK-ORDER-FIRST-RELEASE.md` is what the code
needed. This is the same material ordered by **what blocks what**, with ownership
marked, so you can work from it top to bottom.

**[you]** only you can · **[me]** I will · **[both]** something from you, then me

---

## The long pole — read this before anything else

**Google's identity verification is in flight. Nothing on Play moves until it
lands**, and behind it sits a harder clock.

If your Play account is **personal** — which submitting your own ID suggests —
then before you can apply for production access you must run a **closed test with
12 testers opted in continuously for 14 days.** (Verified 2026-09-28 against
Google's own Play Console documentation. Organisation accounts are exempt; if
yours is an organisation, say so and this whole section changes.)

So the real chain is:

```
identity approved  ->  app created  ->  closed track live  ->  14 continuous days  ->  apply for production
```

Everything else in this document is either preparation for that chain or work
that runs alongside it. **The twelve testers are the only link that cannot be
bought or automated**, and recruiting them is the highest-value thing you can do
this week — the clock can't start without the app, but the people can be lined up
now.

---

## A. While you wait on Google — this week

- [ ] **[you]** Recruit **twelve testers** — names and Google accounts, willing to
      stay opted in for fourteen continuous days without lapsing. A lapse resets
      that tester's contribution, so this is a commitment, not a click.
- [ ] **[both]** Generate the **Android upload key** (`npm run android:keygen`).
      I can run it; the **backup is yours and must live off every machine we
      control.** This is the one unrecoverable loss in the project — with Play
      App Signing it can be recovered through Google, without it, it cannot.
- [ ] **[you]** Sign up for **Resend** (sending) and **Purelymail** (the
      `support@` and `privacy@` mailboxes). Two cards, two accounts.
- [ ] **[me]** Then I write **SPF, DKIM, DMARC and MX** into the Linode zone and
      we create the two mailboxes. This is what makes the contact address in your
      privacy policy real — and the stores check that it works.
- [ ] **[you]** Create the **GitHub environment** `production` and add
      `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`.
      **This is the single gate on all deploy automation** — everything else
      about deploying is already written and waiting. One environment only:
      staging boxes are spun up on demand and are not part of the pipeline.
- [ ] **[both]** **Rebuild and bootstrap the server.** I'll write it as one
      scripted command so it's a single line for you, or run it on your word.
      Fresh `linode/ubuntu26.04`, then Docker, a clone at `~/ozymandosis`,
      `deploy/.env`, a swap file and memory caps.

## B. The moment Google approves

- [ ] **[you]** **Create the app** in the Play Console and accept the **Play App
      Signing** terms.
- [ ] **[me]** Have ready: the **store listing copy**, the **asset checklist**,
      and the **Data Safety answers** derived from `docs/DATA-INVENTORY.md`.
- [ ] **[you]** Complete the **App content declarations** — privacy policy URL,
      data safety form, content rating questionnaire, target audience, ads
      declaration, and the account-deletion URL. That last one is already
      technically satisfied, because accounts can be deleted in-app.
- [ ] **[both]** Upload the **signed AAB** to **internal testing** and smoke it
      on your own phone before anyone else sees it.
- [ ] **[you]** Open the **closed test** with your twelve, then leave it alone
      for **fourteen continuous days** — and keep an eye that nobody drops out.
- [ ] **[you]** Apply for **production access**, summarising the testing
      feedback you received. A human reads that summary.

## C. Devices — parallel, any time, and the highest-value hour in this list

- [ ] **[you]** **Fifteen minutes on a mid-range Android.** The frame rate is
      still the largest unverified claim in the project, and the cheapest test
      with the biggest consequences: if a mid-range phone cannot hold 30 fps, the
      plan changes rather than the code.
- [ ] **[you]** **Two phones on LAN**, playing a full match; then the same with
      the service blocked entirely.
- [ ] **[both]** **iOS** — ⚠️ *the iOS code has never been compiled, because
      there is no Xcode on this side.* It needs Codemagic's free tier:
      **[you]** create the account, **[me]** wire the build.
- [ ] **[you]** The **API 36 restricted-network test** — the one the emulator
      would not give us. It is the clause that stops local-network permissions
      becoming next year's emergency.

## D. Yours, and deferrable

- [ ] **[you]** **Counsel review** of the privacy policy and terms. Both are
      still marked as drafts, and both are public.
- [ ] **[you]** **Trademark search** for "Ozymandosis" before the name goes
      public on a store.
- [ ] **[you]** **Code signing.** Android's is free. **Windows and Apple are
      purchases** — defer them until Steam and iOS respectively.
- [ ] **[you]** **Branch protection on `main`**, plus Dependabot and secret
      scanning. Small, free, and it stops a mistake being permanent.

## E. Steam — lead time worth knowing now, spending worth deferring

- [ ] **[you]** Steam Direct's **$100 per app** starts a **21-day** wait, and the
      store page must be publicly visible as *Coming Soon* for **two weeks**
      before launch. End to end that is **about five weeks.**

      **The only platform whose lead time is longer than the build.** If you
      want Steam on day one, that clock has to start roughly six weeks before.
      Nothing else in this document waits on it.

---

## What I can do with nothing from you

So you can see what is genuinely blocked and what is not:

- the store listing copy and the asset checklist;
- the Data Safety answers from the data inventory;
- the Codemagic wiring for iOS, and the rebuild bootstrap as one script;
- and anything you ask for in the code itself, on the same gate as everything
  else: green CI on the House runner, then merged.

## What I cannot do, and will not pretend to

The accounts, the signatures, the payments, the hardware, the lawyer, and the
twelve people. Those are the ones that need you — and one of them, the testers,
is the only item in this document that can put the launch back by a fortnight.
