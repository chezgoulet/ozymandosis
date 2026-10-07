# Submitting to F-Droid

Everything F-Droid needs is in this repository now. What follows is what a person still has
to do, and the one question to ask them before anything else.

## The question to ask first

Send this to F-Droid (their forum at <https://forum.f-droid.org/> or the issue tracker on
<https://gitlab.com/fdroid/fdroiddata>). It is R7 in `docs/open-sourcing/README.md`, and its
answer decides whether the main repository is reachable at all:

> **Subject: Capacitor/Node build — may `prebuild` fetch npm packages?**
>
> Ozymandosis (github.com/chezgoulet/ozymandosis) is an AGPL-3.0 Capacitor app. The Android
> project lives in `android/`, and the web assets it packages are produced by Node:
> `npm ci`, then `node tools/build-web.cjs` (esbuild), then `npx cap sync android`.
>
> So the recipe's `prebuild` needs to install npm dependencies and fetch esbuild from the
> registry. Is network access during `prebuild` permitted on the build server, or does the
> whole build have to run offline? If it must be offline, what is the recommended shape for
> a Capacitor project — vendoring `node_modules`, a `srclibs` entry, or something else?
>
> The build itself is a plain Gradle Android build and needs no network. The toolchain is
> pinned in the tree (JDK 21, build-tools 34.0.0, Gradle 8.14.3, AGP 8.13.0), and two builds
> of one commit produce an identical APK, so the reproducible-builds path is the intended
> one.

## The recipe

`com.ozymandosis.game.yml` in this directory is the fdroiddata recipe, kept here so it
travels with the release it describes. It passes their own linter — `fdroid lint` from
`fdroidserver` 2.4.5, clean — which is how it was written rather than guessed: the category
list alone has `Strategy Game`, not the `Game` or `Games` a person would type.

To submit: copy it to `metadata/com.ozymandosis.game.yml` in a fork of `fdroiddata` and open
a merge request. The first build on their infrastructure is where the answer to the question
above becomes visible.

## What is already in place

- Fastlane metadata under `fastlane/metadata/android/en-US/`: title, short description (55
  characters, no trailing dot), full description, the 0.5.1 changelog, the icon, and two
  phone screenshots.
- A FOSS licence in the tree (`LICENSE`, AGPL-3.0) with `NOTICE`, and SPDX headers on the
  source.
- No Google dependency in the APK at all — asserted by a CI job that inspects the packaged
  artifact, not just the build file.
- Reproducible builds: a CI job on every release tag builds an unsigned APK at two different
  paths and fails the release if they differ.
- Release tags, which is what `AutoUpdateMode: Version` and `UpdateCheckMode: Tags` need.

## After their first build

R10: verify the published APK on F-Droid's Verification Server and link the result from the
release notes. That is the proof that their rebuild matches ours, and it is the last step of
the submission rather than the first.

## Two things to fix first, found while preparing this

- The **Spawnforge button label truncates to "Spawnfo…"** at phone width, visible in
  `images/phoneScreenshots/2.png`. Measured rather than guessed: the colony row is a grid of
  six equal columns on a 390px screen, so each button gets ~64px and the word needs ~70 at
  the 11px floor the design sets for coarse pointers. Three ways out, and they trade
  different things — **shorten the label** (the game already says "Spawn" in the bottom bar;
  the Spawnforge is a deliberate piece of vocabulary, so it is a naming decision), **widen
  the row floor to ~84px** so it wraps to two lines (measured: the sheet grows tall enough
  that `test/touch.test.cjs`'s map-pan assertion at (200,400) lands on the panel instead of
  the map, so it costs usable map area on a phone), or **leave it** and accept it in the
  listing. I tried the middle one, saw the test fail, and reverted rather than spend the map
  area without asking.
- **`js/core/seed.js`** is verbatim code from the Bioluminescent Dreamscape pack, carrying no
  licence header and absent from `NOTICE`. If the pack is ours it belongs in `NOTICE` as
  ours; if it is not, its licence has to be named. F-Droid's scanner reads this.
