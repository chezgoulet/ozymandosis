# Releasing on Android

Everything between the code and the Play internal testing track. The one step that
cannot be undone quickly is losing the upload key: back it up before the first upload.

## Versions: one source

The root `package.json` is the version of record. `node tools/version.cjs` writes it
everywhere else it appears and `npm test` fails if any of them drift:

| Place | What |
|---|---|
| `package.json` | the source |
| `apps/play/package.json` | the service |
| `apps/desktop/package.json` | desktop shell (Steam) |
| `android/app/build.gradle` | `versionName`, and `versionCode` derived as major·10000 + minor·100 + patch |
| `ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION`, and `CURRENT_PROJECT_VERSION` (the same derived number) |
| `js/net/online.js` | `E.VERSION`: the peer protocol hello, crash reports, the service's minimum-version check |
| `index.html` | the version on the main menu |
| `package-lock.json` | npm's copies |

```
npm run version:set -- patch        # or minor, major, or an exact 0.6.0
git diff --stat                      # every place above, and nothing else
```

`versionCode` only ever climbs (Play refuses one it has seen); the tool refuses a lower
version. 0.5.1 (versionCode 501) is the first tagged release; the first *public* one is whatever the stores ship. When a release must stop
older clients playing online, raise `MIN_CLIENT_VERSION` (or the admin console's live
config) to match.

## Signing: the upload key

Play App Signing holds the key that signs what players install. We sign uploads with an
**upload key**, which proves an upload came from us.

1. `npm run android:keygen` — creates `~/.ozymandosis/upload-keystore.jks` (outside the
   repository) and `android/keystore.properties` (git-ignored) pointing at it.
2. **Back it up now, somewhere that is not this machine**: the keystore file and its
   password (password manager, plus an encrypted copy kept elsewhere). Check the copy
   opens with `keytool -list -keystore <copy>`. A lost upload key can be reset through
   Play support, but it takes days and blocks every release meanwhile.
3. CI instead sets `OZY_UPLOAD_KEYSTORE`, `OZY_UPLOAD_KEYSTORE_PASSWORD` (and optionally
   `OZY_UPLOAD_KEY_ALIAS`, `OZY_UPLOAD_KEY_PASSWORD`).

## A signed bundle

```
npm run android:aab
```

Checks the versions agree, builds the web assets, syncs Capacitor, runs
`bundleRelease`, and verifies the result is signed (`jarsigner -verify`, with a signer
certificate). Output: `android/app/build/outputs/bundle/release/app-release.aab`. It
needs JDK 21 (Capacitor 8); the script uses `~/jdk-21` when `JAVA_HOME` is unset. Build
output stays out of git.

In Play Console: create the app (`com.ozymandosis.game`), **accept Play App Signing**,
register the upload key's SHA-256 (the keygen prints it), then upload the bundle to
**Testing → Internal testing**.

## There is no Play Billing

The app sells nothing. It is free on every platform and membership is bought on the
website (`docs/MONETIZATION.md`, revision of 2026-10-06), so **there is nothing to set up
on the Play side**: no subscriptions, no service account, no Real-time Developer
Notifications, no license testers buying anything, no `google-services.json`. The app
carries no Google dependency of any kind — that is enforced by a test that reads
`build.gradle`.

What the closed test proves, then, is the *free* experience: that it installs, signs in,
plays online inside the daily allowance, and survives an update. The membership path is
proved on the website instead — subscribe in the browser, come back, and the account
shows *Member*; cancel from the account page and it returns to the allowance.

The service's Play code (`apps/play/src/billing/play.ts`, the Play Integrity proof and the
`GOOGLE_PLAY_*` settings) is unreferenced by any shipping client. It is slated for
deletion and is not part of this flow.

## Local network: the Android 17 permission

From API 37 the local network is blocked by default. The app targets 36 and compiles
against 37 (`compileSdkVersion "android-37.0"`) so the permission path is built now.
Hosting asks for `ACCESS_LOCAL_NETWORK` (37+) or `NEARBY_WIFI_DEVICES` with
`neverForLocation` (33–36); finding a game on 37+ uses the system picker and asks for
nothing. Test the 37 behaviour on an API 36 build:

```
adb shell am compat enable RESTRICT_LOCAL_NETWORK com.ozymandosis.game
adb shell pm set-permission-flags com.ozymandosis.game android.permission.NEARBY_WIFI_DEVICES user-set user-fixed   # "don't ask again": hosting must fail politely
adb shell pm clear-permission-flags com.ozymandosis.game android.permission.NEARBY_WIFI_DEVICES user-set user-fixed
```

Then host on one phone, find it on the other, play to the end; and again joining only
with the code the host shows.
