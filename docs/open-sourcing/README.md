# Open-sourcing Ozymandosis

Decision record and course of action for taking the game open source, distributing it through F-Droid's main
repository, and monetising it directly. Written 2026-10-06. Each document below is a working record: where a
later decision overturned an earlier one, the revision is appended rather than the earlier text deleted, so the
reasoning survives.

## Decisions of record

1. **The game goes open source.** Closed-source distribution through the app stores is dropped as the primary
   rail; the reason is not ideology alone — it is that F-Droid's audience is the audience, and that a store
   takes a cut and dictates the payment rail.
2. **Licence: AGPL-3.0.** It obliges publishing the source of everything users interact with over a network.
   The server lives in this same repository (`apps/play`), so publishing the repo satisfies it. It does *not*
   oblige publishing the database, `.env`, signing keys or user data — keeping those out of the tree is correct
   practice. It is incompatible with the App Store, which was already ruled out, so iOS stays "a web app later".
3. **Monetisation: Stripe subscriptions, enforced server-side.** An open client is a patchable client, so any
   client-side subscription check is a suggestion. What people pay for must be a *service this server holds*:
   online play, hosted worlds, persistent state, cloud saves, seasonal content. The billing plumbing already
   exists in `apps/play` (Stripe, Postgres, argon2, migrations, admin and inventory scripts).
4. **F-Droid: the main repository only.** No self-hosted F-Droid repository. Discovery, trust and automatic
   updates come from the main repo; immediacy comes from Obtainium pointing at tagged GitHub releases and a
   direct APK. Nothing self-hosted to sign, host or explain.
5. **Google Play: a waiting track, not a workstream.** The closed-test setup already exists and is waiting on
   twelve testers holding an opt-in for fourteen continuous days. The open-source launch is the recruitment for
   those testers. Nothing is spent on Play until the FOSS rails ship.
6. **Reproducible builds: required, not polish.** They are what let F-Droid publish *our* signed APK instead of
   re-signing it, and therefore the only way two rails can update each other's installs.

## The course

**R1 — Remove the Google dependencies.** `billing`, `play:integrity` and the `google-services` plugin come out
of the Android build. The plan already implies it: Stripe replaces Play Billing, and Play Integrity exists only
to attest Play-delivered binaries.
**R2 — Licence and attribution.** AGPL-3.0 `LICENSE`, SPDX headers, and a `NOTICE` covering three.js (MIT) and
every Capacitor/Fastify/Electron dependency. Confirm the launcher art and `icon.svg` are ours.
**R3 — History hygiene, before the repo goes public.** Scan the full git history for keys and tokens; rotate
anything found. `.gitignore` protects the present, not the past.
**R4 — Generate the release keystore now.** It is the one irreversible decision: if Play ever goes to
production, it must be enrolled with *this* key, and that cannot be revisited after a first Play release.
**R5 — Pin every toolchain.** Gradle, AGP, the JDK, Node, the SDK build-tools, and `apksigner` explicitly.
**R6 — Build twice and diff, in CI, on every release tag.** Fail the release on any difference.
**R7 — Ask F-Droid about the Node build.** Before writing the recipe: what do they recommend for a
Capacitor/npm project, and what is the network policy during `prebuild`? This is the largest open risk.
**R8 — Write the fdroiddata recipe, early.** It is now the only F-Droid rail, and it is the artifact that
surfaces build problems while they are cheap. Fields are named in the rails document.
**R9 — Tag releases.** With `AutoUpdateMode: Version` and `UpdateCheckMode: Tags`, tagging *is* the release
process for the F-Droid rail.
**R10 — Prove it.** Verify the published APK on F-Droid's Verification Server and link the result from the
release notes.

## Open questions

- **The Node/Capacitor build on F-Droid's infrastructure**: whether their build environment may fetch npm
  packages during `prebuild`. Decides whether the main repository is reachable at all. Ask them.
- **Play policy on a website-purchased subscription** for an in-app experience, in our target jurisdictions. A
  legal question, not a technical one.
- **Whether every shipped asset is ours.** The inventory says the shipped asset set is 36 PNGs and one SVG — the
  Android launcher and splash art plus `icon.svg` — with no audio and no bitmap art in the game itself, because
  the visuals are drawn at runtime. If any of that is not ours, it becomes a licence decision rather than a
  formality.

## Documents

- [`compliance-audit.md`](compliance-audit.md) — what the tree already satisfies, the three blocking
  dependencies, the asset inventory, and the licence implications.
- [`reproducible-builds-and-signatures.md`](reproducible-builds-and-signatures.md) — how F-Droid's verification
  works, the automations that exist, the signature mechanics across rails, the rail decision and its revisions,
  and the recipe fields to use.
- [`open-source-plan.md`](open-source-plan.md) — the original process and implications analysis: what F-Droid
  requires, what the change is worth, and what it costs to become the store.
