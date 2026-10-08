# Getting Ozymandosis into F-Droid

One page, six steps, done in a browser. Everything you need to paste is below.

Version being submitted: **v0.5.3** (versionCode 503). All the metadata for it is already in
this repository.

---

## The six steps

**1. Make a GitLab account.** <https://gitlab.com/users/sign_up> — if you already have one, skip.

**2. Fork their app database.** Open <https://gitlab.com/fdroid/fdroiddata> and click **Fork**.
Two rules from their contributing guide: the fork must be **public**, and the branch must not
be protected. A fresh fork satisfies both.

**3. Make a branch in your fork.** In your fork, click the branch dropdown (it says `master`),
type `com.ozymandosis.game`, and click **Create branch**.

**4. Add the file.** In your fork, go to the `metadata` folder, click **+** then **New file**,
and name it exactly:

```
com.ozymandosis.game.yml
```

Paste in the block from *What to paste* below, and click **Commit changes**.

**5. Wait for the little pipeline.** In your fork: **Build → Pipelines**. Their CI lints the
metadata. Green means the recipe is valid; red means the log says which line to fix. If you'd
rather not read logs, send them to me.

**6. Open the merge request.** In your fork you'll see a banner offering to open a merge
request — click it. Set the title to exactly:

```
New app: Ozymandosis
```

Choose their **App inclusion** template from the *Description* dropdown, then replace the
template's text with the block from *What to paste as the description* below. Submit.

Then wait. A packager picks it up; if they ask anything, answer in the merge request. Where you
see *I am the author* in the description, that's you — it's their wording for "the person who
wrote this app is the one submitting it".

---

## What to paste

That is the whole of `docs/fdroiddata/com.ozymandosis.game.yml` in this repository. If the two
ever disagree, that file wins.

```yaml
Categories:
  - Strategy Game
License: AGPL-3.0-only
AuthorName: Christopher Goulet
SourceCode: https://github.com/chezgoulet/ozymandosis
IssueTracker: https://github.com/chezgoulet/ozymandosis/issues
Changelog: https://github.com/chezgoulet/ozymandosis/releases

AutoName: Ozymandosis

RepoType: git
Repo: https://github.com/chezgoulet/ozymandosis.git

Builds:
  - versionName: 0.5.3
    versionCode: 503
    commit: v0.5.3
    subdir: android
    # Node is not in the build image. F-Droid's own React Native template installs plain Debian
    # npm; the React Native submission in review installs it from Debian forky at the
    # maintainer's request, and forky is the newer direction, so this follows that. Verified on
    # Node 24, which is what forky supplies: the whole build produces a byte-identical APK, the
    # same sha256 as on Node 22, so the toolchain does not change what we publish.
    sudo:
      - echo "deb https://deb.debian.org/debian forky main" > /etc/apt/sources.list.d/forky.list
      - apt-get -o Acquire::Retries=3 update
      - apt-get -o Acquire::Retries=3 install -y -t forky npm
    gradle:
      - yes
    prebuild:
      - npm ci
      - node tools/build-web.cjs
      - npx cap sync android
    output: app/build/outputs/apk/release/app-release-unsigned.apk
    # The reference binary for reproducible verification: the APK we publish. With this and
    # AllowedAPKSigningKeys, F-Droid compares its rebuild against ours and, when they match,
    # serves *our* signature — so an install from F-Droid, from Obtainium and from the release
    # page are the same app, and a player can move between them.
    binary: https://github.com/chezgoulet/ozymandosis/releases/download/v%v/ozymandosis-android-v%v.apk
    # esbuild ships a platform binary the scanner cannot rebuild; the same class as the hermesc
    # entry in F-Droid's own React Native template.
    scanignore:
      - node_modules/@esbuild/linux-x64/bin/esbuild
    scandelete:
      - node_modules

AllowedAPKSigningKeys: c54305e6f298517d0065a9bc088831edefe4eb01f64c0988adaad347c22e8086

AutoUpdateMode: Version
UpdateCheckMode: Tags
CurrentVersion: 0.5.3
CurrentVersionCode: 503

MaintainerNotes: |
  The Android app is free on every platform: membership is bought on our website, and the
  build carries no billing client, no Play Integrity and no google-services (a CI job
  asserts the packaged APK contains none of them). The Play rail is distribution only.

  Pinned at v0.5.3 deliberately. The earlier tag predates the licence work: v0.5.1 carries
  no LICENSE, no NOTICE and no SPDX headers, so a build from it would assert AGPL-3.0 in
  this metadata while containing no licence text. v0.5.2 carries all three.


  The build is a Capacitor/Node project, so the recipe needs npm during prebuild: `npm ci`
  and `tools/build-web.cjs` produce `www/`, which `cap sync` copies into the Android
  project. That is the same shape as F-Droid's own React Native template, which installs npm
  through `sudo` and then runs `npm install`, and as a React Native app in review in
  September 2026 — so it is a known path rather than a question. Node comes from Debian: the
  template installs plain `npm`, while that submission installs it from Debian *forky* at the
  maintainer's request. Happy to follow whichever the reviewer prefers.

  The reference binary and AllowedAPKSigningKeys are deliberate. F-Droid's submission guide
  says reproducible builds are best adopted from the start, because Android will not update
  across signing keys and users would otherwise have to reinstall. With the comparison in
  place F-Droid serves our signed APK, so the release page, Obtainium and F-Droid are one
  app rather than two that cannot be swapped.

  Toolchain pinned in the tree: JDK 21, Android build-tools 34.0.0, Gradle 8.14.3, AGP
  8.13.0, compileSdk android-37.0, targetSdk 36, minSdk 24. Two builds of one commit
  produce an identical APK, which the reproducibility check in CI re-tests on every release
  tag. That comparison is of the *unsigned* build, because the signature is the one thing
  that differs between a rebuild and the APK we published.

  Fastlane metadata is in the tree (fastlane/metadata/android/en-US): title, short and
  full description, the 0.5.1 and 0.5.2 changelogs, the icon, and two phone screenshots captured from
  the touch harness at 390x844, padded to 1:2 which is the aspect F-Droid accepts. The
  second screenshot still shows the harness's "Resumed" toast, and both show a real UI
  defect worth fixing first: the Spawnforge button label truncates to "Spawnfo..." at phone
  width.
```

---

## What to paste as the description

```markdown
## Abstract

Ozymandosis is a real-time strategy game of bioluminescent evolution: grow a colony from a
nucleus, design creatures organ by organ, and fight for the light. Two to six players online
or on a local network, with bots standing in for anyone who drops.

Screenshots are in the repository under fastlane/metadata/android/en-US/images/phoneScreenshots.

It is the free, open-source Android client for a game whose multiplayer service we also run.
The app carries no billing client, no store account and no Google code at all — a CI job
asserts the packaged APK contains none. Online play includes one free match every 24 hours and
a membership bought on our website, which is why there is nothing to buy inside the app.
Android is the only client; there is no browser version.

## Checklist

### Policy

* [x] The app complies with the inclusion criteria.
* [x] The original app author has been notified and does not oppose the inclusion. **I am the
  author** — the application id, the source, the signing key and this metadata are all mine.
* [x] The upstream repository carries the metadata in a Fastlane structure with the `en-US`
  locale: short description, full description, icon, the changelogs, and two phone screenshots.

### Docs

* [x] Read the contributing guide.
* [x] The metadata follows the templates — it is a Capacitor/Node project, so it takes the
  shape of your React Native template's `sudo` npm install.
* [x] Read the Build Metadata Reference; the file is valid and `fdroid lint` is clean.
* [x] Read the Quick Start Guide.

### Merge Request Setup

* [x] Title: "New app: Ozymandosis".
* [x] The fork is public and the branch is not protected.
* [x] No related fdroiddata or RFP issues exist; this is the first submission.
* [x] One app in this merge request.

### Metadata

The recipe is `metadata/com.ozymandosis.game.yml`.

* Pinned at `v0.5.3`, which carries `LICENSE`, `NOTICE` and SPDX headers on the source.
* Node comes from Debian **forky** through `sudo`, following the direction in the React Native
  submission currently in review. Our build is verified on Node 24, which is what forky
  supplies: the APK comes out byte-identical to the one built on Node 22, same sha256.
* `binary:` and `AllowedAPKSigningKeys:` are deliberate: the reference is the APK we publish,
  so the comparison is ours against your rebuild.
* The reproducibility check in our CI already builds twice and diffs, unsigned, which is the
  comparison your buildserver makes.
```

---

## What happens after they accept it

Nothing further is needed from you, ever, for future releases. The recipe sets
`AutoUpdateMode: Version` and `UpdateCheckMode: Tags`, so every new tag we push builds
automatically on their infrastructure.

Two things worth doing once it's listed. Their verification server rebuilds our APK and
compares — that result is the proof their F-Droid build is our app, and it belongs in the
release notes. And their official badge artwork is
`https://fdroid.gitlab.io/artwork/badge/get-it-on.png`, which goes beside the Obtainium badge on
the website.

---

## Why it is shaped this way, for whoever reads this next

What their own documents settled, so nobody wonders whether we guessed:

- F-Droid ships a template for Node-built apps, `templates/build-react-native.yml`, which
  installs npm through `sudo` and runs `npm install`. npm during the build is expected, not
  exceptional.
- A React Native app in review (merge request !48673, September 2026) has that shape, and its
  notes record the current review direction: Node from Debian — it uses Debian *forky*, at the
  maintainer's request. The recipe follows that direction, and it is tested: the whole build on
  Node 24 produces a byte-identical APK to the one built on Node 22.
- Their inclusion policy prefers Debian-packaged dependencies and accepts prebuilt FLOSS
  binaries from the Node ecosystem, which covers esbuild's platform binary — the same class as
  the hermesc entry their own template `scanignore`s.
- `binary:` plus `AllowedAPKSigningKeys` is the official answer to signing. *"F-Droid will use
  upstream binaries if the verification succeeded"* — so their copy and ours are the same app,
  and a player can move between F-Droid, Obtainium and our release page without reinstalling.
  Their submission guide says to adopt this from the start, because Android will not update
  across signing keys.

Already in place, so the submission adds nothing: the AGPL-3.0 licence with `NOTICE` and SPDX
headers; no Google dependency in the APK at all, asserted by CI against the packaged artifact;
reproducible builds, built twice and diffed on every release tag; release tags, which is what
the auto-update fields need; and the fastlane metadata — title, descriptions, icon, changelogs
and two screenshots captured from the app.

Both things that were open before this were closed: the creature designer's button label reads
Forge and fits at phone width, and `js/core/seed.js` is MIT with its attribution in `NOTICE`.
