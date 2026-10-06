# Release flow: branches, nightlies, and Play's tracks

The flow agreed 2026-09-29. Recorded because every rule here was established by
checking, and several of them are counter-intuitive enough to be re-derived wrongly.

## Branches, and what each one builds

| Branch | Builds | Goes where |
|---|---|---|
| feature | nothing | a PR into `testing` |
| `testing` | nightly server + nightly APK | nightly Linode instance; APK as a **GitHub pre-release** |
| `main` | release server + release AAB | production Linode; uploaded to a Play track by hand |

`main` is the release truth. A nightly is a rehearsal and is never released from.

## The nightly channel

- **Obtainium installs APKs, not AABs**, and cannot pull from a Play track. The
  nightly is therefore a **GitHub pre-release asset**, on a dedicated device that
  does **not** have the Play build installed — Play App Signing re-signs the store
  copy, so the two identities cannot coexist on one device.
- **The nightly APK must be a release build, signed with the upload key.**
  `npm run android:apk` runs `assembleDebug`, and a debug build is unminified and
  measurably slower — a frame-rate reading from one is a false negative, which
  matters because the frame rate is this project's largest unverified claim. Signing
  with the upload key also avoids the runner's `~/.android/debug.keystore` as the
  channel's identity, which nobody backs up.
- **A private repo means a fine-grained PAT in Obtainium**, scoped to that one repo,
  read-only Contents. Never solve this with a public release-only repo: a nightly
  APK is a playable copy of a $1 game, and that is a giveaway channel.
- **Tag nightlies as pre-releases** so they never pass as releases.
- **Nightlies never touch Play.** Uploading them burns versionCodes permanently and
  would force production to jump above the nightly line forever.

## Play's four tracks, and what each is actually for

- **Internal** — up to 100 testers, starts **before app setup is complete**, builds
  in seconds, and **testers install a paid app for free**. Runs **concurrently** with
  closed and open. Its two irreplaceable jobs: **Play Billing only works here**, and
  it is the only place to smoke the exact artifact Play will deliver. Because it needs
  no app setup, both are available before the deletion URL exists.
- **Closed** — the track that satisfies the personal-account requirement: **12
  testers opted in continuously for 14 days.** Managed by email list or Google Group
  (join the group before opting in), and additional named closed tracks can be
  created. This is the beta tier for the *first* release.
- **Open** — public opt-in from the store listing. **Becomes available only after
  production access**, so it cannot be the first release's beta.
- **Production** — reached by applying, with the testing feedback described. A
  **staged rollout** (1%→100%, same versionCode, pausable) is the native way to roll
  it out gradually.

Opt-in is `https://play.google.com/apps/testing/com.ozymandosis.game`. The link
appears **only once the app status is Published**, and after a track's first publish
it can take **several hours** to become available — budget that before counting day
one of the fourteen.

## The three surprises

- **Pricing and country availability apply across every track.** A beta cannot be
  priced differently.
- **Open and closed testers pay for a paid app.** Only internal is free.
- **Testers cannot leave public reviews on test builds**, so the feedback channel has
  to be ours — and the production application asks what feedback we received.

## Why repository secrets, not environments

`chezgoulet` is on the GitHub **Free** plan and `efflorescent` is **private**, and on
that combination **environments cannot be configured, environment secrets are
unavailable, and required reviewers on a private repo need Enterprise** (they are
public-repo-only on Free, Pro and Team). `deploy.yml` as written would no-op forever
printing "No DEPLOY_HOST for this environment yet" — a failure that reads as "not set
up yet". Secrets go at **repository** level with prefixes, and the branch or a
dispatch input selects the pair. Self-hosted runners do not consume Actions minutes,
so the private-repo allowance is not a constraint.

## The two tests that make "the server cannot affect the app" true

1. **The compatibility contract.** `E.VERSION` in `js/net/online.js` is the peer
   hello and the service carries `MIN_CLIENT_VERSION`. A server deploy may add; it may
   not break a released client without raising `MIN_CLIENT_VERSION`.
2. **The pairing test.** One device running the **released** build points at the
   **nightly** server. This is the check that proves tomorrow's server still serves
   the app players already have. Without it, the nightly only proves the next app
   works with the next server — the pair that was never in doubt.

A nightly with its own deploy path would rehearse a pipeline that is not the one we
rely on, so **the nightly must run the same `deploy/deploy.sh`** as production.
