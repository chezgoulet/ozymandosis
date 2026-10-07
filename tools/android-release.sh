#!/usr/bin/env bash
# One command to a signed Android App Bundle for Play (work order §4).
#   npm run android:aab
# Checks that every version agrees, builds the web assets, syncs Capacitor, builds
# the release bundle signed with the upload key, and verifies the signature.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node tools/version.cjs check
if [ -z "${OZY_UPLOAD_KEYSTORE:-}" ] && [ ! -f android/keystore.properties ]; then
  echo "No upload key: run tools/android-keygen.sh once (or set OZY_UPLOAD_KEYSTORE and its passwords)." >&2; exit 1
fi
if [ -z "${JAVA_HOME:-}" ] && [ -x "$HOME/jdk-21/bin/java" ]; then export JAVA_HOME="$HOME/jdk-21"; fi
node tools/build-web.cjs
npx cap sync android
(cd android && ./gradlew --quiet clean bundleRelease)
AAB=android/app/build/outputs/bundle/release/app-release.aab
[ -f "$AAB" ] || { echo "No bundle was produced." >&2; exit 1; }
# jarsigner exits 0 for unsigned files too: require the "verified" line and a signer
OUT="$("${JAVA_HOME:+$JAVA_HOME/bin/}jarsigner" -verify -verbose -certs "$AAB" 2>&1)"
grep -q "jar verified\." <<<"$OUT" || { tail -5 <<<"$OUT"; echo "The bundle is not signed." >&2; exit 1; }
grep -q "X.509" <<<"$OUT" || { echo "The bundle has no signer certificate." >&2; exit 1; }
VERSION="$(node -p "require('./package.json').version")"
CODE="$(grep -oE 'versionCode = [0-9]+' android/app/build.gradle | grep -oE '[0-9]+')"
echo "Signed: $AAB  ($(du -h "$AAB" | cut -f1), version $VERSION, versionCode $CODE)"
echo "Signer: $(grep -m1 -oE 'CN=[^,]+' <<<"$OUT" || true)"
echo "Upload it to the internal testing track in Play Console."
