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

`chezgoulet` is on the GitHub **Free** plan and the repository was **private** when this
section was written, so GitHub's documentation said that on that combination environments
and environment secrets are unavailable, and that required reviewers on a private
repository need Enterprise.

**The repository is now public, and that cuts both ways.** The required-reviewer rule stops
being a plan limitation, and Actions minutes on a public repository are free and unlimited,
so the self-hosted runner is now a choice about *reachability* — the deploy key and the
server's firewall — rather than about cost. The cost is on the other side: the
organisation's `Default` runner group does **not** admit public repositories, so any job
still asking for `[self-hosted, linux, x64]` on this repository queues indefinitely until
that is settled. It was settled once already, for the one-off that turned web checkout on,
by running that job on a hosted runner.

**Measured 2026-10-06: the first half of that is wrong here.** The `production`
environment exists, holds `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and
`DEPLOY_KNOWN_HOSTS` as *environment* secrets, and deploys have run through them — the
run that put `v0.5.1` live read them successfully. What is genuinely unavailable is the
**required-reviewer protection rule** (the API refuses it with a 422 naming the billing
plan), so `deploy.yml` gates on a two-name actor allowlist instead.

Treat the doc claim as the shape it is: a platform limitation recorded in a runbook is a
claim about when it was written. Environment secrets work; only the reviewer rule does
not. Self-hosted runners do not consume Actions minutes — and the general jobs have since
moved to GitHub-hosted runners anyway, so that allowance is no longer a constraint.

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
