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
*Status 2026-10-06: **amended — this is a build split, not a removal.** Play is kept as a parallel rail with its
own binary. See the revision at the end of this document.*
**R2 — Licence and attribution.** AGPL-3.0 `LICENSE`, SPDX headers, and a `NOTICE` covering three.js (MIT) and
every Capacitor/Fastify/Electron dependency. Confirm the launcher art and `icon.svg` are ours.
*Status 2026-10-06: `LICENSE` and `NOTICE` landed, and the fonts' OFL text is vendored beside them. **SPDX headers
are still outstanding** — that is the one piece of R2 left.*
**R3 — History hygiene, before the repo goes public.** Scan the full git history for keys and tokens; rotate
anything found. `.gitignore` protects the present, not the past.
*Status 2026-10-06: done. Every object reachable from every ref (104 commits, 1,786 blobs) was scanned and every
match resolved by reading the code; nothing needs rotating. The only thing the history carries that the tree does
not is ~4 MB of screenshots, and removing those would rewrite every SHA.*
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

## Revision — two rails, built in lockstep (2026-10-06, owner)

**Decisions 1 and 5 are amended, not reversed.** The game still goes open source, and F-Droid's main repository
is still the primary rail. What changes is that **Google Play is kept as a parallel rail with its own binary**,
released from the same tag as the FOSS one rather than parked while the FOSS rails are built.

- **R1 is a split, not a removal.** The Android build grows two flavours from one source tree: `play` keeps
  `com.android.billingclient`, `com.google.android.play:integrity` and the `google-services` plugin; `foss`
  carries none of them. Same `applicationId`, same signing key, same `versionCode` — that is what makes the two
  binaries one app to Android, so a player can move between rails without losing anything. F-Droid points at the
  `foss` binary.
- **The `foss` flavour buys on the website.** Decision 3 said Stripe, enforced server-side; the consequence is
  that this build offers Stripe Checkout from the account page instead of an in-app purchase, and `WEB_BILLING`
  is on for it. A web membership is deliberately platform-agnostic — the subscription row carries no platform —
  so it counts everywhere, which is the point of buying it on the web.
- **The lockstep is enforced, not promised.** `tools/version-check.cjs` ties `versionCode` to the version across
  every marker the tree carries, so a tree whose two flavours disagree cannot be tagged.
- **Reproducible builds (decision 6) become more load-bearing, not less.** F-Droid verifies *its* build of the
  `foss` flavour against the APK we publish, and sameness between the rails is what keeps a rail-switch honest.
- **Play policy is unchanged and still open.** The question of a website-purchased subscription for an in-app
  experience applies to the store rails, not to the `foss` one, where there is no store policy to satisfy.

## Revision 2 — one free binary; Play for distribution only (2026-10-06, owner)

The revision above amended decisions 1 and 5 to keep Play as a parallel **rail** with its own binary, in lockstep
with the FOSS one. **That is superseded.** The store rail is not worth a second binary, and the numbers were
measured before deciding: 158 lines of Java, 185 lines of service code, 311 lines of tests, a permanent build
flavour, a third Google dependency (Play Integrity), store policy to stay inside, and a closed test gated on
twelve testers holding an opt-in for fourteen continuous days — spent to buy **discovery**, not control. The
purchase gate it rested on was already unenforceable: Play Integrity attests that a binary came from Play, and an
AGPL client can be patched by anyone.

**What is true now:**

- **One free binary.** The Android app carries no Google dependency of any kind: `com.android.billingclient`,
  `com.google.android.play:integrity` and the `google-services` plugin are gone, `PlayBillingPlugin.java` is
  deleted, and `MainActivity` no longer registers it. **R1 is a removal again, not a split** — the flavour
  question never has to be answered.
- **Membership is bought on the website, on every rail**, through Stripe. The client offers it when its build
  cannot buy in a store and the server reports that it sells on the web; the account page owns checkout,
  cancellation and the billing portal.
- **Play is kept for distribution.** The listing, the closed test and the store's update channel stay. What is
  gone is in-app purchase, Play Integrity, and the gate that asked for them.
- **The service no longer requires a store purchase to play.** The handshake gate demanded a client claim
  `android`/`ios`/`steam` and hold a store-verified purchase; a free client cannot produce that and a patched one
  could always lie about it. `REQUIRE_STORE_CLIENT` is removed with it. What gates a player is the free daily
  allowance and the membership — both the server's own, which is what decision 3 said the product should rest on.
- **The Play policy question narrows to steering.** A free app may not direct users to buy outside Play; it does
  not have to. Inside the app, the membership is simply present or absent.
- **Two tests were inverted rather than deleted**, because they were the policy written down: the inventory test
  asserted the Play Billing dependency was present and now asserts no Google artifact is; the store-rules test
  asserted a browser was refused and a store client needed a verified purchase, and now asserts that every client
  connects — including one that claims no platform at all.

**Done since:** that Play integration came out — `billing/play.ts`, its test file, the Android ownership proof
and the `GOOGLE_PLAY_*` configuration, 438 lines with sixteen added back. And the website has one home again: the
stale copy under `apps/site` is deleted, and `chezgoulet/ozymandosis-site` (GitHub Pages) is the site.

## Status — 2026-10-06, end of day

| | |
|---|---|
| **R1** Google dependencies | **Done.** None in the app; a CI job asserts the packaged APK contains none. |
| **R2** Licence and attribution | **Done.** `LICENSE` (AGPL-3.0, text verified against SPDX and the FSF's GPL-3), `NOTICE`, the fonts' OFL, SPDX headers on 129 source files, `license` in the four manifests. **Except** `js/core/seed.js`, verbatim third-party code that needs a licence decision — see the open questions. |
| **R3** History hygiene | **Done.** Every object from every ref scanned; nothing needs rotating. |
| **R4** Release keystore | **Done.** `~/.ozymandosis/upload-keystore.jks`, 0600. |
| **R5** Pin the toolchain | **Done.** JDK 21 enforced at configuration time; build-tools 34.0.0 (which carries apksigner); Gradle 8.14.3 and AGP 8.13.0 pinned in the tree; Node pinned to 22 in CI. |
| **R6** Build twice and diff | **Done.** A CI job on every release tag builds an unsigned APK at two different paths and fails the release if they differ. Measured first: two builds of one commit give an identical SHA-256. |
| **R7** Ask F-Droid about the Node build | **Drafted, not sent.** The question is written out at `docs/fdroiddata/README.md` for you to send; it is the one thing blocking a submission. |
| **R8** Write the fdroiddata recipe | **Done.** `docs/fdroiddata/com.ozymandosis.game.yml`, and it passes their own `fdroid lint`. Fastlane metadata and two phone screenshots are in the tree. |
| **R9** Tag releases | **Done.** `v0.5.1`, and the pipeline refuses a tag that does not name the tree's version. |
| **R10** Prove it on the Verification Server | **Waits on R7 and the first build on their infrastructure.** |

Two other open questions stand as recorded: the Play policy question about a website-purchased subscription
(narrowed, since the app sells nothing), and whether every shipped asset is ours — `js/core/seed.js` is the one
piece of code that is not.
