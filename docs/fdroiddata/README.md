# Submitting to F-Droid

Everything F-Droid needs is in this repository now. What follows is what a person still has
to do, and the one question to ask them before anything else.

## What reading their docs settled (2026-10-07)

There is no question to ask before submitting. The path is documented and in use:

- F-Droid ships a template for Node-built apps, `templates/build-react-native.yml`, which
  installs npm through `sudo` and then runs `npm install`. npm during the build is expected,
  not exceptional, and the template points at the metadata directory for more examples.
- A React Native app is in review with exactly that shape (`fdroiddata` merge request !48673,
  September 2026), and its notes record the current review direction: install Node/npm **from
  Debian** — that submission uses Debian *forky*, at the maintainer's request.
- Their inclusion policy prefers Debian-packaged dependencies where they exist, and accepts
  prebuilt FLOSS binaries from the Node ecosystem — which covers esbuild's platform binary,
  the same class as the hermesc entry their own template `scanignore`s.
- The signature question has an official answer. `binary:` plus `AllowedAPKSigningKeys` makes
  our published APK the reference for reproducible verification, and *"F-Droid will use
  upstream binaries if the verification succeeded"* — so their copy and ours are the same app,
  and a player can move between F-Droid, Obtainium and our release page without reinstalling.

So the next step is the submission rather than a question: copy the recipe into a fork of
`fdroiddata` and open a merge request. Details like the exact Node source get settled with the
reviewer on the merge request, which is how the app in review is doing it. The one thing worth
raising in the description is whether they prefer plain Debian npm (their template) or Debian
forky (the newer direction).

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
  characters, no trailing dot), full description, the changelogs for 0.5.1 and 0.5.2, the icon, and two
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
