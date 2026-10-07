# Ozymandosis on two rails: F-Droid and Google Play

Answering the question properly, with the mechanism verified from both sides' documentation rather than
remembered. Written 2026-10-06.

## The finding that decides the architecture

**Signature continuity is the whole problem, and it is solvable — but only if you choose it up front.**

- **Google Play**: Play App Signing is mandatory for apps created after August 2021 — *but you may choose the
  key.* Google's own documentation: if you "would like to choose the app signing key for a new app instead of
  having Google generate it", you **sign with your own key and upload that key to Play App Signing**, then
  register a separate *upload* key for future submissions. So the APKs Play delivers can carry **your**
  signature.
- **F-Droid**: packages not set up for reproducible builds get **an F-Droid-generated signing key**, which by
  definition differs from yours. The consequence is stated plainly in their developer FAQ: a user switching
  between an F-Droid install and one you signed themselves "would have to take the additional step of
  uninstalling and reinstalling the app", because Android only upgrades in place on a matching signature.
- **With reproducible builds**, F-Droid verifies their rebuild against your published APK and can then
  **publish your signed binaries** — via the `Binaries:`/`Builds.binary:` and `AllowedAPKSigningKeys:`
  directives, implemented as part of `fdroid publish`. Their documentation notes this approach "allows
  publishing both APKs signed by the (upstream) developer and APKs signed by F-Droid", which is what keeps
  updates working for users who arrived from either direction.

**So: one keystore, signed builds everywhere, and reproducibility is what lets F-Droid publish that same
signed artifact instead of re-signing it.** Your instinct that reproducibility is necessary here is exactly
right — it is necessary *because* you want two rails that can update each other, not as a purity exercise.

## How the mechanism actually works

F-Droid verifies reproducible builds through the **APK signature**: they copy the signature block from your
signed APK onto their unsigned rebuild and check that it verifies. Since **v2/v3 signatures cover every other
byte of the APK**, the two builds must be *identical apart from the signature block*. Practical consequences,
from their documentation:

- **Use `apksigner`** (shipped reproducibly in Debian) rather than a hand-rolled signing path — the copy
  algorithm assumes what `apksigner` produces.
- **Pin the Android SDK build-tools** in `build.gradle`. Differing build-tools change XML and PNG bytes.
- **NDK-built code is far more sensitive**: the same NDK version on different host platforms produces different
  binaries. If we ship native code, pin the platform *and* the NDK.
- **Timestamps, build paths and sort-order sensitivity** are the usual culprits. Modern AGP helps: since
  Gradle Android Plugin 2.2.2 the ZIP metadata timestamps in the APK are zeroed.
- **A verified trap in CI**: GitHub Actions Ubuntu images from July 2024 ship Android build-tools 35, so the
  **`apksigner` version must be explicitly pinned to 34** rather than taken from the template. That single
  detail is the difference between a build that verifies and one that mysteriously does not.

## The automations that exist

**F-Droid side**

- **`fdroidserver`** — `fdroid build`, `fdroid update`, `fdroid publish`. Runs in their container images, so it
  belongs in CI.
- **`fdroid publish` with `Binaries`/`AllowedAPKSigningKeys`** — automatically verifies your signed APK against
  the recipe build and publishes *your* binary. This is the automation that makes the dual-rail story work.
- **The Verification Server** (`verification.f-droid.org`) — upload an APK and get back whether it matches the
  published source build. This is how we prove reproducibility to a stranger, and it should be linked from our
  release notes.
- **fdroiddata** — the recipe repository; the main-repo listing is a merge request against it.

**Play side**

- **Fastlane `supply`** and the community `upload-google-play` GitHub Action are the standard paths for
  automated uploads, track promotion and release notes.
- Play App Signing is configured once in the console, with the key upload at enrolment and an upload key
  thereafter.

**Reproducibility in our own CI**

- Build the release twice in two clean environments — one of them a Debian container matching F-Droid's
  toolchain — and compare with `diffoscope` (and `apksigcopier` for the signature-block comparison).
- Fail the release on any difference. A build that only reproduces on one machine is not reproducible.

## The variant question, and why it may not apply

The textbook pattern is Gradle product flavours: a `foss` flavour with no proprietary dependencies and a `play`
flavour carrying Google services. F-Droid then builds the `foss` variant.

**But for this app the ideal may be no variants at all.** Because the plan replaces Play Billing with Stripe,
and Play Integrity exists only to attest Play-delivered binaries, **the three Google dependencies can simply be
removed rather than moved behind a flavour.** That gives the strongest possible story: one artifact, signed
once, shipped to both rails, and the thing F-Droid verifies is literally the thing Play ships.

**The one thing that could force a `play` flavour is Play's payment policy, not technology.** Google requires
Play Billing for digital goods and services consumed in-app, with narrow exceptions (the EEA external-offers
program among them, post-DMA). So the real question is what the Play build does about payment:

1. **Play build with Play Billing** → a `play` flavour, a second billing integration server-side (Google's
   Developer API notifications alongside Stripe webhooks), two artifacts, and reproducibility verified per
   variant. The most policy-safe and the most work.
2. **Play build with no billing, subscription bought on the site** → one artifact, but a compliance risk under
   Play's payment policy for in-app digital content, and jurisdiction-dependent.
3. **F-Droid plus direct/Obtainium only** → none of this. One rail family, one signature, one billing
   integration, no policy question, and Play's discovery lost.

Option 3 is what the earlier analysis already leaned toward, and this is the strongest argument for it: the
dual-rail arrangement's only genuinely hard constraint is a payment policy that F-Droid does not have.

## The course

**R1 — Decide the payment question** (the fork above). Everything else follows from it.
**R2 — Remove the Google dependencies** and confirm one artifact builds, runs and passes the existing tests.
**R3 — Generate the release keystore now, and enrol Play with *that* key** if Play is in scope. A key decision
made after the first Play release cannot be revisited — the app signing key is effectively permanent.
**R4 — Pin every toolchain**: Gradle, AGP, the JDK, the Node version, the SDK build-tools and an explicit
`apksigner` version.
**R5 — Build twice and diff** in CI, on every release tag, with `diffoscope`; publish the result.
**R6 — Add `Binaries` + `AllowedAPKSigningKeys` to the fdroiddata recipe** so F-Droid publishes our signed APK.
**R7 — Automate the two upload paths** (Fastlane `supply` or `upload-google-play` for Play; `fdroid update` for
the self-hosted repo), driven from the same tagged release.
**R8 — Prove it to a stranger**: verify the published APK on the Verification Server and link the result.

## What I would still verify before committing

- F-Droid's build environment for a **Capacitor/npm** project: what Node version their buildserver provides,
  and whether npm dependencies must be vendored or declared as `srclib`s. This is the same open question from
  the compliance audit and it is the largest remaining unknown.
- Whether Play's current policy treats a website-purchased subscription for an in-app experience as compliant in
  our target jurisdictions. That is a legal question for someone qualified, not a technical one for me.


---

# The rail decision (2026-10-06)

**Recommendation: drop Play. Ship F-Droid, a self-hosted F-Droid repo, Obtainium and a direct APK. Treat Play
as a later, additive option you take only on a real demand signal.**

## The three arguments that actually decide it

1. **The expensive part of Play is not the fee, it is the second billing integration.** Play requires Play
   Billing for digital goods consumed in-app, so a Play release means Google's purchase-verification flow living
   beside Stripe's webhooks — permanently: code, testing, refunds, disputes, receipts, and a policy surface that
   can change under you. That is the whole reason to think twice, and it is not a one-off cost.
2. **Consistency.** You already refused the App Store. Being on Play while refusing Apple is the most expensive
   shape available: you would maintain store machinery for one store and refuse its twin. If the principle is
   *we manage it ourselves*, it applies to both. If it is *reach*, it needs both — and you have ruled that out.
3. **Play's realistic gain is smaller than it sounds.** A listing gets you a page, search, and Play Protect. It
   does not get you editorial features for a niche RTS, virality, or your friends' attention. The actual gain is
   "someone who already knows the name can install it in three taps" — which a website with a QR code also
   provides.

## The honest counter-argument

**Volume.** Play is where the overwhelming majority of Android users are; F-Droid's audience is a rounding error
beside it. If Ozymandosis is a *business*, that asymmetry is the whole argument for Play, and no amount of
philosophical tidiness answers it. The way to settle it is empirical rather than ideological: **does anyone who
is not already in the FOSS bubble want this?** If the answer turns out to be yes, Play is the cheap way to reach
them, and the billing integration becomes worth its cost.

## Why this decision is less fraught than it looks

Separate what is irreversible from what is deferrable.

**Irreversible, and cheap to get right now:**

- **The package name.** It is the app's identity across every rail and every future store.
- **The signing key.** Generate the release keystore now and keep it forever. If Play ever happens, enrol with
  *this* key as the app signing key — the choice cannot be revisited after a first Play release.
- **`versionCode` discipline** — monotonically increasing, never reused, so any rail can upgrade any install.

**Deferrable, and merely additive later:** the Play Billing integration, the `play` product flavour, the Play
listing, the fdroiddata merge request. All of it can be built when there is a reason.

So the decision to make today is not "Play or no Play". It is: **pick a package name, generate the keystore, keep
the version codes honest** — and then ship on the rails that need no permission. If Play ever earns its way in,
nothing above has been foreclosed.

## What this means for the release course

The earlier stages are unchanged, and two of them get easier: **there is no `play` flavour and no variant
divergence** — one artifact, one signature, and reproducibility is verified against exactly the binary every
user installs. R3 stands and matters more: **generate the keystore now**, because it is the one decision the
future cannot undo.

## One correction to the earlier analysis

I said Play takes "15–30%" and Stripe "2.9% + 30¢". That is right for one-off purchases and wrong for
subscriptions: Play's subscription fee has been 15% since 2022. On a $5/month subscription the difference is
roughly 30 cents a month, not a dollar fifty. The fee is not the argument — the second billing integration and
the policy surface are. Verify the current terms if the margin ever becomes the deciding factor.


---

# Status: Play becomes a waiting track (2026-10-06, owner)

Revised from "drop Play" to "keep it, deprioritised". The reasoning is sound and worth recording, because it
turns an open decision into a cheap one: **the Google Play closed-test setup already exists and is waiting on
testers, not on work.** Abandoning it would throw away a sunk asset for no gain.

## What the waiting actually is

For a personal developer account, production access requires a **closed test with at least twelve testers
opted in for fourteen continuous days** — opt-in is what is measured, not engagement. So the blocker is twelve
people holding an opt-in, which is precisely the traction problem in miniature. Confirm the current wording
before relying on it; this policy has moved more than once.

**Which points at the actual move: the open-source launch is the recruitment.** The audience that will install
a FOSS build from F-Droid is exactly the audience likely to opt into a Play closed test. Announcing the AGPL
release and asking for twelve testers solves the Play requirement as a side effect, instead of the requirement
being a hurdle in front of it.

## The three things that must stay true for Play to remain cheap

1. **Package name stays fixed.** It is the identity across every rail; changing it later means a new app.
2. **`versionCode` stays monotonically increasing and never reused**, so whichever rail a user is on can upgrade
   them from another rail's build.
3. **Generate the keystore now** (already R3), and **if Play ever goes to production, enrol it with that key** as
   the app signing key. If Google generates the key instead, Play-delivered installs can never be upgraded in
   place from F-Droid or a direct APK, and the reproducibility work buys nothing for those users.

## What low priority must not become

Spending release-engineering effort on Play before the FOSS rails ship. Nothing about the closed test requires
billing or Google dependencies, so the Play track can idle for free — the billing integration, the `play`
flavour and the production listing are all still deferrable and additive, exactly as the decision above says.

**Gate: when the FOSS build ships *and* twelve testers have held an opt-in for fourteen days, decide then
whether Play goes to production.** Until both are true, Play is a bookmark, not a workstream.


---

# Revision: the main F-Droid repository only, no self-hosted repo (2026-10-06, owner)

**Decision: no self-hosted F-Droid repository.** The app goes into F-Droid's **main repository**, with
Obtainium and a direct APK as the fast lane. That removes a whole workstream — signing our own repo, hosting
it, and telling users to add a URL — and it is the cleaner shape anyway: discovery, trust and automatic updates
come from the main repo, immediacy comes from Obtainium pointing at tagged GitHub releases.

## What main-repo-only changes

**Nothing self-hosted to maintain, and updates become automatic.** Once accepted, `AutoUpdateMode: Version`
with `UpdateCheckMode: Tags` means that tagging a release *is* the release process for that rail — their build
cycle picks it up and the F-Droid client updates users. Both fields exist in the metadata reference.

**But there is no fallback.** If their build breaks, updates stop until it is fixed. So the recipe's robustness
is the whole game, and the build must be reproducible on their infrastructure rather than merely on ours.

**Cadence belongs to them.** A tagged release appears in days, not minutes — which is exactly why Obtainium and
the direct APK stay in the plan: they are the instant lane, not the redundancy.

**Reproducibility now carries the signature question.** Without it, F-Droid signs with **their own generated
key**, which makes F-Droid users a signature island: uninstall-and-reinstall to move to or from Play or a direct
APK. With it, they publish *our* signed APK via **`Binaries` + `AllowedAPKSigningKeys`** — both real fields —
and every rail shares one signature. Since signature continuity is the stated goal, this is no longer optional
polish; it is the mechanism.

## The risk that is now the whole risk

**There is no npm or Node field in F-Droid's build metadata.** The reference offers `Builds.prebuild`,
`Builds.sudo`, `Builds.srclib`/`srclibs`, `Builds.maven`, `Builds.gradle`, `Builds.init`, `Builds.binary` — and
nothing for Node. So a Capacitor app is built there by one of: `prebuild` commands (possibly through `sudo`) to
install the JS dependencies, `srclibs` pointing at the plugin sources, or committing a vendored dependency tree.

**The specific unknown is the network policy during `prebuild`** — whether their build environment may fetch
Node packages, and if not, what the sanctioned alternative is. That decides whether the Capacitor layer can be
built in the main repo *at all*, and it is the thing to ask them directly, before investing in the recipe.

**One fact is strongly in our favour: the client's dependency set is tiny.** Seven official Capacitor plugins,
`esbuild`, and `three` — which is *already vendored in the tree*. An app with four hundred npm dependencies
would be hopeless here; this one is plausibly vendorable by hand or declarable as `srclibs`. That is the
difference between "ask them and proceed" and "choose a different architecture".

## The mitigation ladder, in order

1. **Ask F-Droid** (issue or MR comment) what they recommend for a Node/Capacitor build, and what the `prebuild`
   network policy is. Cheapest possible resolution, and it shapes everything else.
2. **Vendor the client's dependencies** (~8 packages plus their transitive closure) and commit them, so the
   Android build needs no network and the JS build step is deterministic.
3. **Declare the plugins as `srclibs`** where upstream provides suitable source.
4. **Only if all else fails**, make the Android build self-contained from committed JS source with a
   documented, pinned bundling step — remembering that the main repo requires building from source in-repo, so a
   committed *prebuilt bundle* alone is not acceptable.

## Named fields for the recipe, for when we write it

`License: AGPL-3.0-or-later` · `Categories` · `SourceCode` · `IssueTracker` · `Builds:` with `gradle: [assembleRelease]`
plus `prebuild` as needed · `AutoUpdateMode: Version` · `UpdateCheckMode: Tags` · `CurrentVersion` and
`CurrentVersionCode` · `Binaries` and `AllowedAPKSigningKeys` if publishing our signature · `AntiFeatures` only
if something genuinely applies (with the assets nearly empty, likely nothing does).

## Course change

The self-hosted repository step is **deleted**. The **fdroiddata recipe moves from last to early**, because it is
the artifact that surfaces the build problems while they are still cheap to fix, and because the main repo is now
the only F-Droid rail we have.
