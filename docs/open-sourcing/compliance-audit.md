# Ozymandosis: F-Droid compliance and reproducible-build audit

Audit of `chezgoulet/efflorescent` at `fix/playtest-client-0.5.1` (65 commits, 306 tracked files), read-only on
the playtest host. Goal: what stands between the current tree and an AGPL F-Droid release.

## The verdict in one line

**The code is already almost all FOSS — the blockers are three Android dependencies and the paperwork.** The
dependency audit came back clean everywhere except one file, and the asset problem is far smaller than feared.

## Verified: what complies

- **All four packages are FOSS throughout.** Root: Capacitor 8 plus seven official plugins, `esbuild`, `three`,
  `playwright`. `apps/play`: Fastify 5, `@node-rs/argon2`, `arctic`, `nodemailer`, `pg`, `qrcode`, **`stripe`**,
  `zod`. `apps/desktop`: Electron plus `bonjour-service`. `apps/site`: no dependencies.
- **The subscription plumbing already exists and is already server-side** — Stripe, Postgres, argon2 password
  hashing, migrations, an admin script, an inventory script. That is the right architecture for an open client
  and it is built.
- **Assets are almost nothing.** 36 PNGs and one SVG, 9.5 MB total, and they are the Android launcher icons and
  splash screens plus the source `icon.svg`. **Zero audio, zero bitmap art in the game itself** — the visuals are
  drawn at runtime, which is what you told me. So the NonFreeAssets question is nearly empty: confirm the
  launcher art and the SVG are your own work and the shipped asset set is libre.
- **three.js is vendored** (`vendor/three.webgpu.min.js` with a `vendor:three` script) rather than fetched at
  build time, and it is MIT.
- **Secret hygiene at the tree level is good.** `.gitignore` covers `.env`, `android/keystore.properties`,
  `*.jks`, `*.keystore`, and the server's data directory. Only `deploy/.env.example` and a credentials how-to are
  tracked.
- **CI exists** (`ci.yml`, `deploy.yml`) and a lockfile is committed.

## The blockers

### 1. Three Google dependencies in the Android build — the hard one

`android/app/build.gradle` contains:

```
implementation "com.android.billingclient:billing:8.0.0"     // Google Play Billing
implementation "com.google.android.play:integrity:1.4.0"    // Play Integrity
classpath 'com.google.gms:google-services:4.4.4'             // Google Services plugin
```

And the build output confirms they are really linked — `play-services-base` and `play-services-basement` appear
in the merged release resources. **Google Mobile Services is exactly what F-Droid names as unacceptable, and
"Billing" is the rail you are leaving.** So this is not a compromise to negotiate; it is a removal that the new
plan already implies:

- **Play Billing goes** because Stripe replaces it.
- **Play Integrity goes** because it exists to attest that a binary came from the Play Store — it is meaningless,
  and actively hostile, for a build users compile or verify themselves.
- **The `google-services` plugin goes** with them, since nothing else needs it.

That removal also *simplifies* the app: no billing client to keep in step with a store, no integrity token to
verify server-side.

### 2. No licence file, and no tags

There is no `LICENSE`, `COPYING` or `NOTICE` anywhere in the tree, and **zero git tags**. F-Droid requires a
FOSS licence in the repo and a tag on every release commit. Both are cheap; both are prerequisites.

### 3. The unanswered questions the audit cannot settle from here

- **Can the client build offline on F-Droid's infrastructure?** Their build server builds from your tagged
  source. `three` is vendored, but the Capacitor/npm layer is not, and node packages sometimes ship prebuilt
  binary blobs. This is the one item to verify against their build docs before promising anything.
- **Does the git *history* contain anything secret?** Publishing makes every commit public. `.gitignore` protects
  the present, not the past. A history scan for keys and tokens is mandatory before the repo flips public, and
  anything found means rotation, not deletion alone.

## Reproducible builds: what is actually required

Two different goals, often conflated:

1. **Building from source (required).** F-Droid builds it themselves, so the tree must build from a clean
   checkout with a lockfile and no network-fetched toolchain. This is the requirement.
2. **Reproducible builds (optional, and only for signature continuity).** If they can rebuild your APK bit-for-bit
   they will publish *your* signature, so updates flow between your direct/Obtainium builds and F-Droid. If not,
   they sign with their own key — and then users must uninstall and reinstall to move between rails.

**Recommendation: aim for (1) now and (2) later.** Concretely, for (2): pin every toolchain version (Gradle
8.13.0, AGP 8.13.0, the Node version, Capacitor 8), embed no build dates, no git hashes and no random ids in
bundled output, build from a clean checkout with `npm ci`, and prove it by building twice in two clean
environments and comparing with `diffoscope`. Reproducibility is a *result* of discipline, not a switch.

## AGPL: what it obliges, and what it does not

You lean AGPL, and the tree supports it cleanly.

- **It obliges:** publish the source of everything users interact with over a network. The **server is in this
  same repository** (`apps/play`), so publishing the repo satisfies it — and it should also be linked from the
  app, the convention being an "About → Source" entry.
- **It does not oblige:** publishing your database, your `.env`, your signing keys, or user data. Keeping
  `deploy/.env`, `android/keystore.properties` and `apps/play/data/` out of the tree is therefore correct
  practice, not evasion.
- **It is incompatible with the App Store**, which you had already decided against — so nothing is lost, and the
  iOS path stays "a web app later".
- **It protects the work:** anyone who hosts a derivative must publish their changes, so the server side cannot
  be quietly taken closed.

## The course, in order

**G1 — Remove the Google dependencies.** Drop billing, integrity and the google-services plugin; make the Android
build work without them; prove the release APK builds and runs (it should already, since the app's own payment
path is Stripe over the browser).
**G2 — Licence and attribution.** AGPL-3.0 `LICENSE`; SPDX headers on source files; a `NOTICE` covering three.js
(MIT) and every Capacitor/Fastify dependency; confirm the launcher art and `icon.svg` are yours.
**G3 — History hygiene.** Scan the full history for keys and tokens; rotate anything found. Do this *before* the
repo goes public, since the window closes the moment it does.
**G4 — Build reproducibility from a clean clone.** A documented `docs/BUILD.md` that works from a fresh checkout,
enforced by CI, with the toolchain versions pinned. Then the two-clean-build comparison.
**G5 — Metadata and tags.** Fastlane metadata (short description under 80 characters with no trailing dot, full
description, icon, two screenshots, per-version changelog under 500 characters) and a tag on every release
commit.
**G6 — Ships on the two rails that need no queue.** Self-hosted F-Droid repo plus Obtainium, signed with your
own key. This is where the game is playable by strangers with a verifiable binary.
**G7 — The main repository.** The fdroiddata recipe as a merge request, once the build is clean and reproducible.
This is the credibility rail, and it is the last step rather than the first.

## One thing I could not determine

Your note about assets — that some will be retained and some cannot be freed, because drawing is central — I read
as: *a third-party asset set stays proprietary while the game's own visuals are generated*. The inventory supports
the second half strongly (36 PNGs, no audio, everything else drawn). If some of the launcher art is not yours,
say so and it changes G2 from a formality into a decision: either replace it or accept the NonFreeAssets flag,
which is a disclosure rather than a rejection.
