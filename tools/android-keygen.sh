#!/usr/bin/env bash
# Generate the Android upload key, once, for the life of the app (docs/RELEASE-ANDROID.md).
# It is written OUTSIDE the repository, and android/keystore.properties (git-ignored)
# is pointed at it. Back it up off this machine before the first upload: with Play
# App Signing a lost upload key can be reset through Play support, but it takes days
# and blocks every release until then.
#   tools/android-keygen.sh [path/to/upload-keystore.jks]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KS="${1:-$HOME/.ozymandosis/upload-keystore.jks}"
PROPS="$ROOT/android/keystore.properties"
# Find a JDK the same way android-release.sh does: a bare `keytool` is not on
# PATH for a non-interactive shell, and this is the FIRST tool anyone runs, so
# without this the key generation is the one step that cannot find it.
if [ -z "${JAVA_HOME:-}" ]; then
  for j in "$HOME/jdk-21" "$HOME"/jdk-*; do
    if [ -x "$j/bin/keytool" ]; then export JAVA_HOME="$j"; break; fi
  done
fi
KEYTOOL="${JAVA_HOME:+$JAVA_HOME/bin/}keytool"
command -v "$KEYTOOL" >/dev/null 2>&1 || {
  echo "keytool not found: install a JDK or set JAVA_HOME (looked in \$HOME/jdk-*)" >&2; exit 1; }
if [ -e "$KS" ]; then echo "Refusing to overwrite $KS (it may be the only copy of the upload key)." >&2; exit 1; fi
mkdir -p "$(dirname "$KS")"; chmod 700 "$(dirname "$KS")"
read -r -s -p "Keystore password (16+ characters, into your password manager): " PASS; echo
[ "${#PASS}" -ge 16 ] || { echo "Too short." >&2; exit 1; }
"$KEYTOOL" -genkeypair -v -keystore "$KS" -storetype PKCS12 -alias upload -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=Ozymandosis upload key, O=Ozymandosis"
chmod 600 "$KS"
umask 077
printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=upload\nkeyPassword=%s\n' "$KS" "$PASS" "$PASS" > "$PROPS"
echo
"$KEYTOOL" -list -v -keystore "$KS" -storepass "$PASS" | grep -E "SHA256:" | head -1
cat <<MSG

Upload key: $KS   (android/keystore.properties points at it; both are outside git)
NOW, before anything else:
  1. Copy $KS somewhere that is not this machine (an encrypted USB key kept elsewhere,
     and the password manager's file attachments), and the password into the password manager.
  2. Check the copy opens:  keytool -list -keystore <the copy>
  3. When creating the app in Play Console, accept Play App Signing and register this
     upload key (the SHA-256 above).
MSG
