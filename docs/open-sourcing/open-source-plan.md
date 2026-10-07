# Ozymandosis: open source, F-Droid, and Stripe — process and implications

Thinking through the change of heart, 2026-10-06. Written to my own workspace rather than the repo, since a
session may be working in that tree.

## The decision in one sentence

Open source plus F-Droid buys: no platform tax, no store dictating the payment rail, a build users can verify,
and copyleft that stops anyone taking your work closed. It costs: **the paid check has to live on your server**,
and the app must build from source with FOSS-only dependencies on infrastructure you do not control.

## What F-Droid actually requires, verified from their own guide

- **A public repository with a real FOSS licence file** — and the real source in it, not a placeholder.
- **FOSS dependencies only.** Firebase and Google Mobile Services are named explicitly as unacceptable; if the app
  can work without them in any capacity, ship a flavour that does. Build tools must be FOSS too — a proprietary
  IDE requirement disqualifies it, and they build from the command line regardless.
- **The author has been notified and does not oppose** — you are the author, so this is free.
- **Fastlane/Triple-T metadata in the repository**, before inclusion: `short_description.txt` (under 80
  characters, no trailing dot), `full_description.txt`, `images/icon.png`, `images/phoneScreenshots/1.png` and
  `2.png`, and `changelogs/<versionCode>.txt` capped at 500 characters.
- **Every release commit tagged**, matching the version in the manifest.
- **A build recipe in their fdroiddata repository**, offered as a merge request: descriptive fields including
  `License`, `SourceCode`, `Categories`, `AntiFeatures`, `Donate`/`Liberapay`, plus the build steps.

## The business implication nobody should miss

**An open-source client is a patchable client.** Any subscription check implemented in the app is a suggestion,
not a control. So the paid thing must be a **service your server holds**: online play, hosted worlds and
persistent state, cloud saves, seasonal content. That is not a problem for an RTS with online play — it is
the natural shape — but it does mean the free app must be genuinely usable alone, and the subscription must
buy access to *your* infrastructure rather than unlock a local flag.

Stripe, concretely: **2.9% + 30¢** against a store's 15–30%. On a $5 subscription that is about $4.55 kept
rather than $3.50–$4.25. What you inherit with it: subscription lifecycle webhooks and a server that is the
source of truth, SCA/3DS in Europe, **tax** (VAT and GST on digital services to consumers, which the stores
used to absorb), refunds, chargebacks, dunning and grace periods, and account handling — signup, verification,
password reset, deletion. Stripe's customer portal does a real part of that work, and Stripe Tax does another,
but **you have become the store**.

## Three rails, and I would run two of them at once

1. **F-Droid main repository** — credibility, discovery, automatic updates, and a build others can reproduce.
   The costs are a review queue, a build that must keep working on their infrastructure, and a release cadence
   partly outside your control.
2. **Your own F-Droid repository** — self-hosted, your key, instant releases, and users add it like any other
   repo. Same tooling, no queue. This is the pragmatic middle.
3. **Obtainium or a direct APK** — instant, no review, no discovery. You already ship something this way.

**Recommendation: self-hosted repo plus Obtainium from day one, and submit to the main repository once the build
is clean.** The main-repo build is the thing that *proves* the FOSS claim, and it is also the fiddliest, so it
should not gate your releases.

## The two hard technical questions

1. **Can it build offline on their infrastructure?** F-Droid builds from your tagged source on their build
   server. For a Capacitor/JavaScript app that means dependency resolution without network access, which is the
   classic obstacle for node projects — and node packages sometimes ship **prebuilt binary blobs** (React Native
   and Expo projects have hit exactly this: precompiled AARs in `node_modules`, linked by default). Every
   Capacitor plugin has to be checked. **This is the thing to verify before committing**, and the mitigation is
   either a reproducible static web bundle inside a thin wrapper, or vendored dependencies.
2. **What is in the app today?** A dependency audit is needed: `npm ls`, the Gradle dependencies, each Capacitor
   plugin, and anything Firebase-, GMS-, analytics- or crash-reporting-shaped. If it uses Play Billing, that
   comes out — which the Stripe plan does anyway.

## Decisions that follow

- **Licence.** Copyleft is the standing preference and there is no dual licence. The open question is *which*:
  **GPL-3** leaves your server private, **AGPL** extends the obligation to the hosted service. GPL plus an
  honestly-proprietary backend is a legitimate and common shape; AGPL is the more open promise.
- **Assets.** If the art and music are not libre, expect the **NonFreeAssets** flag — disclosed, not fatal.
  Either relicense them (CC-BY-SA) or accept the flag deliberately. Same logic for a proprietary backend:
  **NonFreeNet** is a disclosure, not a rejection.
- **Signature.** F-Droid signs with their own key unless you do reproducible builds and keep yours. Since you
  also ship directly and through Obtainium, keeping **one signature everywhere** is worth the effort —
  otherwise users must uninstall and reinstall to move between rails.
- **What the subscription buys**, stated in one line, and therefore what the free tier genuinely gets. This is
  the product decision the whole change turns on.

## What the change is really worth

The beta-traction problem was never that the game was bad; it was that a closed beta among friends is a small
room. F-Droid and the FOSS-game audience are a much larger room, and a verifiable build is a story that
community actively wants — no trackers, no ads, no platform tax. But that audience skews to people who want
things free: treat them as the **funnel and the credibility**, not the revenue, and price the supporter tier
accordingly. Donations belong on the listing too (F-Droid surfaces `Donate`, `Liberapay`, `OpenCollective`),
because that is the rail that audience actually uses.

## Next concrete steps

1. Audit dependencies for anything non-FOSS, and check what the Android build links.
2. Settle the licence (GPL-3 or AGPL) and the asset licence.
3. Decide the signature strategy, and what the subscription unlocks server-side.
4. Add the Fastlane metadata and start tagging release commits.
5. Set up the self-hosted repo, ship through Obtainium immediately, and prepare the fdroiddata recipe for the
   main repository as the slower, credibility-building second rail.
