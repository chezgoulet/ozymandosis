# Releasing on Android

Everything between the code and a signed APK on the release page. **The one step that
cannot be undone quickly is losing the release key**: back it up before the first upload.

> This file replaced a Play-oriented version on 2026-11-17. The app is free and listed in no
> store (D22, `docs/MONETIZATION.md`), so there is no AAB, no track, no Play App Signing and
> no internal-test upload. What survives from that world is the key and the discipline about
> it. For the whole launch, see `docs/RELEASE-CHECKLIST.md`.

## Versions: one source

The root `package.json` is the version of record. `node tools/version.cjs` writes it
everywhere else it appears and `npm test` fails if any of them drift:

| Place | What |
|---|---|
| `package.json` | the source |
| `apps/play/package.json` | the service |
| `apps/desktop/package.json` | desktop shell (development shell, not a rail) |
| `android/app/build.gradle` | `versionName`, and `versionCode` derived as major·10000 + minor·100 + patch |
| `js/net/online.js` | `E.VERSION`: the peer protocol hello, crash reports, the service's minimum-version check |
| `index.html` | the version on the main menu |
| `package-lock.json` | npm's copies |

```
npm run version:set -- patch        # or minor, major, or an exact 0.6.0
git diff --stat                      # every place above, and nothing else
```

`versionCode` only ever climbs; the tool refuses a lower one, because Android will not
install a downgrade over an existing app. When a release must stop older clients playing
online, raise `MIN_CLIENT_VERSION` (or the admin console's live config) to match — a floor,
deliberately lagging the release, so a new build does not lock out everyone on the last one.

## The release itself

Pushing a `v*` tag on `main` runs `.github/workflows/release-client.yml`. In order, and each
step can fail the release:

1. `tools/release-scope.cjs` decides whether this tag touches the client at all, so a
   service-only tag does not cut a client release.
2. `tools/ci-status.cjs` refuses a tagged commit that has not passed CI.
3. **Reproducible**: the tree is built twice at two different paths and the two unsigned
   APKs must be byte-identical. Two directories on purpose — an APK that embeds its own
   build path would pass a same-directory test and fail F-Droid's, which is the comparison
   that matters.
4. `tools/version-check.cjs` holds the tag against all seven markers.
5. The GitHub Release is created with `tools/release-notes.cjs`.
6. The APK is built with the release key, verified with `apksigner --print-certs`, and only
   then attached with a `.sha256`.

So cutting a release is: bump the version, merge `testing` into `main`, push the tag.

## Signing: the release key

The key lives in the `production` environment as four secrets —
`OZY_UPLOAD_KEYSTORE_B64`, `OZY_UPLOAD_KEYSTORE_PASSWORD`, `OZY_UPLOAD_KEY_ALIAS`,
`OZY_UPLOAD_KEY_PASSWORD` — and the workflow asks GitHub for the environment, not the
repository. Its SHA-256 is the `AllowedAPKSigningKeys` value in the F-Droid recipe, which
is what lets F-Droid serve our signature and makes Obtainium, F-Droid and the release page
one app instead of two that cannot be swapped.

1. `npm run android:keygen` — creates `~/.ozymandosis/upload-keystore.jks` (outside the
   repository) and `android/keystore.properties` (git-ignored) pointing at it, and prints
   the certificate's SHA-256.
2. **Back it up now, somewhere that is not this machine**: the keystore and its password
   (password manager, plus an encrypted copy elsewhere). Check the copy opens with
   `keytool -list -keystore <copy>`. Every existing install is signed with this key; losing
   it means every player has to uninstall and reinstall to get an update.
3. CI exports the same values from the environment secrets above.
4. A local signed build sets `OZY_UPLOAD_KEYSTORE` and the password variables and runs the
   release variant by hand. `npm run android:apk` builds **debug** — it is a development
   command, and a debug build is unminified and measurably slower, so a frame-rate reading
   taken from one is a false negative.

## There is no store, and nothing to sell in the app

The app sells nothing: membership is bought on the website (`docs/MONETIZATION.md`, ruling
of 2026-11-05). There is no Play listing, no in-app purchase, no StoreKit or Play Billing,
no `google-services.json`, and the service's Play Integrity code and `GOOGLE_PLAY_*`
settings were removed on 2026-11-16. That the app carries no Google dependency is enforced
by a test that reads `build.gradle`.

The membership path is therefore proved on the website, not in a store: subscribe in the
browser, come back, and the account shows *Member*; cancel from the account page and it
returns to the daily allowance.

## Distribution

- **Obtainium** reads GitHub Releases and installs each new tag's APK. Nothing to do per
  release beyond tagging.
- **F-Droid** builds from the recipe in `docs/fdroiddata/com.ozymandosis.game.yml`. It is
  pinned at one version for the first submission; after that `AutoUpdateMode: Version` with
  `UpdateCheckMode: Tags` lets it pick up new tags itself. `docs/fdroiddata/README.md` is
  the submission walkthrough.

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
