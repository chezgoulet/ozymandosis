# The App Store and Steam

How the iOS and Steam builds sell and prove what `docs/MONETIZATION.md` says, and what
a person sets up. Android is in docs/RELEASE-ANDROID.md. Implementation: D20.

## What the service checks

| | The $1 game (ownership, `/api/ownership/*`) | The membership | Counts on |
|---|---|---|---|
| Android | Play Integrity: Play-recognised, licensed, our nonce | Play Billing, Play Developer API, RTDN | Android |
| iOS | `AppTransaction`, signed by Apple | StoreKit 2 transactions + Server Notifications V2 | iOS |
| Steam | `CheckAppOwnership` for the account's linked Steam id | Season DLC ownership, until its end date | Steam |

Everything Apple signs is verified against Apple Root CA - G3 (pinned in
`apps/play/src/billing/appstore.ts`). The store apps prove ownership by themselves
before going online and at least every 30 days; the player sees nothing unless the
store says no.

## App Store (iOS)

1. **App Store Connect → the app → Monetization → Subscriptions**: one group, products
   `ozymandosis.membership.monthly` ($2, 1 month) and `ozymandosis.membership.annual`
   ($12, 1 year). Different ids go in `APPSTORE_PRODUCT_MONTHLY` / `_ANNUAL`.
2. **App Information → App Store Server Notifications**: version 2, production and
   sandbox URL `https://play.ozymandosis.com/api/billing/appstore/notify`.
3. The app's price: tier for $1.
4. **Sign in with Apple** configured on the service (`APPLE_*`, docs/DEPLOY.md). On iOS
   the game hides Google and Steam sign-in unless Apple sign-in is offered (guideline 4.8).
5. Account deletion is in the game (Settings → Delete account) and on the account page
   (guideline 5.1.1(v)); the dialog reminds a member to cancel in the App Store.
6. TestFlight review builds make sandbox purchases: set `APPSTORE_ALLOW_SANDBOX=true`
   on the server that review uses (never needed in development or tests).
7. Build in Xcode (`npm run ios:open`); `LanPlugin.swift` and `StoreKitPlugin.swift`
   are app-target plugins registered in `MainViewController.swift`. The StoreKit
   capability (In-App Purchase) must be on for the target. Not compiled in CI (no Xcode).

## Steam

1. The game's app id in `STEAM_APP_ID`; a **publisher** Web API key in `STEAM_API_KEY`
   (the partner API answers ownership only with a publisher key).
2. Each year's season is a DLC at $12. List them with their end dates:
   `STEAM_SEASONS=[{"appid": 1234560, "until": "2027-10-01T00:00:00Z"}]`. The game's
   membership offer opens the current season's store page.
3. Steam players sign in with Steam (or link it on the account page): ownership is
   checked for the linked Steam id.
4. The desktop shell is the Steam build when launched by Steam (or with
   `steam_appid.txt` beside it); a build that is neither cannot play online in production.

### The Linux build

A native Linux build that runs inside **Steam Linux Runtime 3.0 (sniper)**: the
container Steam starts for the game, so the libraries are the runtime's on every
machine, never the player's. (A build that runs outside the container, like an
AppImage, works by accident on some distributions and cannot pass Steam Deck review.)

- **The depot is a file tree**: `cd apps/desktop && npm run package` →
  `dist/linux-unpacked/`, executable `ozymandosis`. No AppImage: its FUSE loader
  fights the container, and a depot is files, not an installer.
- **Nothing is bundled beyond Electron**, because nothing is missing. Measured in
  sniper 3.0.20260805.254768 (glibc 2.31), in both the platform runtime and the SDK
  image: every library Electron 38 links resolves (136 of 136, 0 missing), its newest
  glibc symbol is 2.25, and it links no libstdc++. Libraries it may open at run time
  and the runtime lacks are all optional (libunity, libdbusmenu, libsecret, libspeechd,
  GTK 4, NVIDIA GLX on a machine without it). The graphics driver is the one host
  library, which the container imports by design.
- **X11.** Left to itself, Electron picks Wayland on a Wayland desktop; the container
  passes the Wayland socket through, and the app crashes (SIGSEGV) at launch. It is
  started with `--ozone-platform=x11` (Xwayland on a Wayland desktop, gamescope's
  Xwayland on Steam Deck), which is also what the Steam overlay hooks. The switch must
  be on the command line: Electron chooses the platform before `main.cjs` runs, and
  relaunching from `main.cjs` ends the process Steam is watching.
- **Sandbox**: Chromium's user-namespace sandbox works inside the container, so the
  build keeps it; `chrome-sandbox` needs no setuid bit (a depot cannot carry one).
- **Audio** is WebAudio synthesis (js/core/audio.js, music.js; no audio files), played
  through the runtime's libpulse to the host's PulseAudio/PipeWire socket. GStreamer,
  which the runtime omits, is not used.

**Steamworks** (self-serve, no ticket; Valve's
[SLR for game developers](https://gitlab.steamos.cloud/steamrt/steam-runtime-tools/-/blob/main/docs/slr-for-game-developers.md)):

1. Installation → General → a Launch Option: operating system Linux, executable
   `ozymandosis`, arguments `--ozone-platform=x11`.
2. Installation → Linux Runtime → `Steam Linux Runtime 3.0 (sniper)`. The default is
   scout (1.0), which this build is not tested in. Valve now recommends steamrt4
   (Debian 13) for new titles; moving is a change of `VERSION`/`URL` in `sniper.sh`
   and a rerun of the test.
3. The Linux depot is the contents of `dist/linux-unpacked/`.

**Proof, repeatable** (and the `steam-linux` CI job): `apps/desktop/sniper.sh` runs
the build inside the pinned, checksummed runtime exactly as the launch option does;
`node test/steamrt.test.cjs` checks linkage in the container, plays a single-player
match, records the game's own audio stream on the host and requires it audible, and
plays a LAN match between two copies in two containers (found over mDNS, direct
link). Host needs: Xvfb, a PipeWire session (`pw-cli`, `pw-record`, `pw-dump`), and on
Ubuntu 23.10+ the `steam` package's AppArmor profile, under which the container may
create user namespaces (as Steam's own processes do).
