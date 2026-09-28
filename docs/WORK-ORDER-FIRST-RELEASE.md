# Work order: the first release

**This order owns no rule.** The decisions live in `docs/DECISIONS.md` (D19 and
the entries around it), `docs/MONETIZATION.md`, and `docs/LAUNCH.md`. Where this
order and one of those disagrees, the decision document wins and this order is
wrong.

Everything below is code. The human-only work — accounts, the lawyer, the
trademark search, real devices, real payments — is the checklist in
`docs/LAUNCH.md` and is not repeated here.

**One rule about proof.** Every item states how it is proved, and proof means a
command and its output or an observation on a real device — never a description
of what the code should do. A gate that has not been run is not a gate. If an
item cannot be finished, say which part and why; a blocker reported honestly is
worth more than an item marked done.

---

## 1. LAN play — ungated, serverless, permission-correct

**What.** Two devices on the same network find each other and play the full game
directly: no relay, no account, no call to the service. This is a base-game
feature, outside the purchase and the subscription both (see
`docs/MONETIZATION.md`, "The LAN boundary").

**Why it is not just a networking task.** Android gates local networking from
**API 37**, and the app targets 36 today. From 37, the local network is blocked
by default and these operations are behind `ACCESS_LOCAL_NETWORK`: outgoing TCP,
**accepting incoming TCP**, UDP multicast and broadcast, and resolving `.local`
names. That is this entire feature. Built without the permission path, it works
today and breaks at the next Play target-API bump.

**Do it this way.**

- **Joining** uses `NsdManager` with `DiscoveryRequest.FLAG_SHOW_PICKER`: the
  system shows a dialog, the user picks the device, and the grant persists across
  reboots — so the broad permission is never requested. This is also better UI
  for a game: choose the player.
- **Hosting always requires `ACCESS_LOCAL_NETWORK`** on 37+, because accepting
  incoming connections does. Declare it, request it at runtime, and handle denial
  and revocation without a crash or a dead screen.
- For the API 33–36 window declare `NEARBY_WIFI_DEVICES` with
  `android:usesPermissionFlags="neverForLocation"`, asserting that no location is
  derived from it.
- **iOS** needs `NSBonjourServices` **and** `NSLocalNetworkUsageDescription` in
  the plist. Without the usage-description key the permission prompt never
  appears and discovery fails silently — this bug is invisible in the simulator
  and obvious on a device.
- **Desktop** uses the OS resolver; no permission model.

**And a fallback that is not optional.** Discovery can be denied, and guest,
hotel and corporate networks routinely isolate clients so that two devices can
see each other's advertisements and still not connect. Ship a short-code or QR
join that needs no discovery. Discovery is the convenience; the fallback is the
guarantee.

**Proved when:** two clients on one network play a full match **with the service
unreachable** (block the domain or stop the server); no account is signed in; no
match ticket is issued; the rolling-24-hour allowance is unchanged afterwards;
and the same run passes on an API 36 build with
`adb shell am compat enable RESTRICT_LOCAL_NETWORK <package>` enabled.

---

## 2. The relay rule (D19)

**What.** A cross-network match is always relayed. The peer connection is created
with `iceTransportPolicy: 'relay'` unconditionally; the "Hide my IP address"
toggle and its setting are removed. A LAN match (§1) is the exception because it
does not go near the relay at all.

**The trap.** Existing installs have `relayOnly: false` saved in settings. This
must therefore be *unconditional*, not "default true" — otherwise everyone who
ever switched it off stays un-relayed forever.

**Proved when:** two clients on different networks complete a match, and the
selected ICE candidate pair is a relay candidate — read it from the connection
rather than asserting it. No `host` or `srflx` pair is ever selected for a
cross-network match.

**Also worth doing while here:** TURN is now the path every remote match takes,
so an unreachable relay means no online play rather than degraded play. Give it a
health check and put it in the alerting.

---

## 3. Store billing — Android first

**What.** Play Billing for the mobile subscription, at the settled
**$2/month** and **$12/year**. Today an Android player cannot subscribe at all:
store builds show no prices or checkout and there is no Play Billing in the tree.

**Requirements.**

- The service already accepts more than one entitlement source, so this is a new
  source rather than a rebuild. Do not redesign the entitlement model.
- **Validate every purchase server-side** with the Play Developer API. A client
  asserting an entitlement it did not buy is the failure this prevents, and
  "bound to the account" is decorative without it.
- Prices come from the store on mobile; `stripe:setup 1200` creates the annual
  price for the portal.

**Proved when:** a purchase from Play's internal-testing track grants an
entitlement the service validates, and the entitlement survives a reinstall; a
cancelled or refunded subscription removes it at the right time; and the service
**rejects** a forged purchase token. Show the rejection, not just the success.

---

## 4. The release pipeline — signing, AAB, and one version

**What.** Everything needed to put an artifact in front of Play.

- Generate the Android upload key and **back it up somewhere that is not the
  Thelio**. This is the one irrecoverable item in the whole project.
- Wire `signingConfig`, and add a release path that produces a signed **AAB**.
  Today `npm run android:apk` runs `assembleDebug` only.
- Accept the Play App Signing terms when the app record is created.
- **One version source feeding six places.** They currently disagree: Android
  says `versionName 1.2.0` at `versionCode 1`, the desktop shell says `1.2.0`,
  the menu shows players `v1.1`, and the root `package.json`, the service and iOS
  all say `1.0.0`/`1.0`. Play keys every future update off `versionCode`, which
  must climb forever.

**Proved when:** one command produces a signed AAB that Play accepts on the
internal track; and one command bumps the version, with the diff shown to touch
all six places and no seventh place left behind.

---

## 5. The frame-rate instrument

**What.** On-device frame-time measurement: p50/p95/p99 frame times, the
governor's tier transitions, and the device class — readable by a person and
reported where it can be found afterwards.

**Why it is near the front.** `docs/LAUNCH.md` already lists a low-end Android
test, but a test with no instrument produces an impression. This is the cheapest
test that can invalidate the most work: if a mid-range phone cannot hold 30 fps,
the answer changes quality tiers, population defaults and which devices the store
page claims.

**Proved when:** a mid-range Android phone plays fifteen minutes under load and
produces percentiles and a tier-change count, and two runs agree closely enough
that the number means something.

---

## 6. Audit residues

Three small things, each with a decision rather than a fix:

- `bench/results/check.json` is tracked and rewritten by every bench run, so it
  churns in every diff. Either ignore it or commit it deliberately as a record —
  but stop leaving it half-decided.
- The `uuid` advisory through `@capacitor/cli` is build-time only. **Record it as
  accepted** — a note in the repo plus a Dependabot dismissal. An advisory nobody
  has ever addressed trains everyone to skim the list.
- One browser-suite chain run failed during sign-up and could not be reproduced.
  A new form field is exactly what breaks an existing selector or wait, and the
  month/year-of-birth fields are new. Turn on Playwright tracing for that suite
  so the next occurrence is replayable rather than merely printed.

---

## 7. Data-safety inventory, emitted from the code

**What.** The Play Data Safety form, the App Privacy answers and the privacy
policy all need the same facts: what is collected, where it goes, how long it is
kept. The code knows. Have it produce the inventory rather than having a person
reconstruct it from memory, then check it against the form.

**Proved when:** the inventory names each field, its destination and its
retention, and matches what the service actually does — including anything a
third-party SDK collects.

---

## Not in scope

Everything in `docs/ROADMAP.md` — the Behemoths, the campaign, the new
abilities, the terrain work. The core is not shipped yet, and the wishlist waits.
Do not start it, and do not add features to this batch that are not listed here.

## Restrictions

- The monetization is settled (`docs/MONETIZATION.md`). Do not change a price, add
  a gate, or make a subscription work across platforms.
- There is no browser build. `play.ozymandosis.com` is the service, not a client.
- Keep every existing gate green: `npm test`, `npm run play:test`, the browser
  suites, and `npm run test:perf`.
- Build output stays out of git: `www/`, `dist/`, and the Android and iOS build
  directories remain ignored.
- Do not weaken PII handling: `D16` stands, and the new LAN feature must not log
  addresses either.

## How to report

Per item: the acceptance command and its actual output, or the observation and
where it was made. Then, in the same message:

- what was **not** done, and why;
- anything discovered that contradicts a decision document;
- the branch tip, and whether it is pushed — **and re-check that before saying**
  it, because any push by anyone carries the whole branch and a reported branch
  state goes stale.
