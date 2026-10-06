#!/usr/bin/env bash
# Install what the BUILD HOST needs for the Ozymandosis release automation.
#
#   Where: sasquatch (the Thelio), as user `c`.
#   Usage: bash tools/install-build-host.sh [--dry-run] [--prefix DIR] [--no-profile]
#
# Idempotent: re-running changes nothing already correct, and it ends with a
# verification pass that reports each tool as present or missing rather than assuming
# the install worked.
#
# It does NOT touch credentials. Those live in the environment store or a vault, never
# in a repo, a script, or a shell history.
#
# Detection never trusts PATH alone. node, adb, keytool and jarsigner are installed
# here but invisible to a non-interactive shell — the same asymmetry that broke
# android-keygen.sh — so every tool is looked for in its known location as well.
set -euo pipefail

DRY=0; NOPROFILE=0; PREFIX="$HOME/bin"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)    DRY=1; shift ;;
    --no-profile) NOPROFILE=1; shift ;;
    --prefix)     PREFIX="${2:?--prefix needs a directory}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)  ARCHTAG="amd64" ;;
  aarch64|arm64) ARCHTAG="arm64" ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

say()   { printf '  %s\n' "$*"; }
head_() { printf '\n== %s ==\n' "$*"; }

# Where a tool actually is: PATH first, then the known home locations.
bin_of() {
  local t="$1" p c
  p="$(command -v "$t" 2>/dev/null || true)"
  if [ -z "$p" ]; then
    for c in "$HOME/.local/bin/$t" "$HOME/bin/$t" "$HOME/jdk-21/bin/$t" \
             "$HOME/Android/Sdk/platform-tools/$t" "$HOME/Android/Sdk/cmdline-tools/latest/bin/$t"; do
      [ -x "$c" ] && { p="$c"; break; }
    done
  fi
  printf '%s' "$p"
}

# Resolve the first asset of the newest non-prerelease release matching $2 and not $3.
# Returns "NAME<TAB>URL". The URL comes from the API rather than being built from
# /releases/latest/download/, because "latest" is the repository's latest release —
# which for a repo publishing several products is not the one holding your asset.
resolve_asset() {  # $1=repo  $2=name include regex  $3=name exclude regex
  gh api "repos/$1/releases?per_page=30" --jq \
    '.[] | select(.prerelease==false) | .assets[] | "\(.name)\t\(.browser_download_url)"' 2>/dev/null \
  | awk -v inc="$2" -v exc="${3:-}" -F'\t' '{ if ($1 ~ inc && (exc=="" || $1 !~ exc)) { print $1 "\t" $2; exit } }'
}

printf 'build host setup — %s, %s (%s), prefix %s%s\n' \
  "$(hostname)" "$ARCH" "$ARCHTAG" "$PREFIX" "$([ "$DRY" = 1 ] && echo ' — DRY RUN')"

# ---------------------------------------------------------------- already there
head_ "already present"
for t in node npm python3 jq curl openssl unzip zip git gh docker adb ffmpeg java keytool jarsigner; do
  p="$(bin_of "$t")"
  printf '  %-10s %s\n' "$t" "${p:-MISSING}"
done

# -------------------------------------------------------------------- bundletool
head_ "bundletool (user-level, no root)"
if [ -x "$PREFIX/bundletool" ] && [ -f "$PREFIX/bundletool.jar" ]; then
  say "already installed: $("$PREFIX/bundletool" version 2>/dev/null || echo 'present but not runnable')"
else
  ASSET="$(resolve_asset google/bundletool '^bundletool-all-.*[.]jar$' '' || true)"
  if [ -z "$ASSET" ]; then
    say "could not resolve a release asset — install bundletool by hand"
  else
    NAME="${ASSET%%$'\t'*}"; URL="${ASSET##*$'\t'}"
    say "asset: $NAME"
    if [ "$DRY" = 1 ]; then
      say "would download $URL -> $PREFIX/bundletool.jar (+ wrapper $PREFIX/bundletool)"
    else
      mkdir -p "$PREFIX"
      curl -fsSL -o "$PREFIX/bundletool.jar.part" "$URL"
      mv -f "$PREFIX/bundletool.jar.part" "$PREFIX/bundletool.jar"
      printf '#!/usr/bin/env bash\nexec "%s/jdk-21/bin/java" -jar "%s/bundletool.jar" "$@"\n' \
        "$HOME" "$PREFIX" > "$PREFIX/bundletool"
      chmod 755 "$PREFIX/bundletool"
      say "installed: $("$PREFIX/bundletool" version 2>&1 | head -1)"
    fi
  fi
fi

# ------------------------------------------------------------------------ PATH
head_ "PATH for non-interactive shells"
MARK="# ozymandosis build host PATH"
LINE="export PATH=\"\$HOME/bin:\$HOME/jdk-21/bin:\$HOME/Android/Sdk/platform-tools:\$PATH\"  $MARK"
if [ "$NOPROFILE" = 1 ]; then
  say "skipped (--no-profile)"
elif grep -qF "$MARK" "$HOME/.profile" 2>/dev/null; then
  say "already in ~/.profile"
elif [ "$DRY" = 1 ]; then
  say "would append to ~/.profile: $LINE"
else
  printf '\n%s\n' "$LINE" >> "$HOME/.profile"
  say "appended to ~/.profile (effective in new login shells)"
fi
if [ "$NOPROFILE" = 1 ] || ! grep -qF "$MARK" "$HOME/.profile" 2>/dev/null; then
  say "note: until ~/.profile carries that line, npm and any other tool with a node"
  say "      shebang fails in a non-interactive shell, because it cannot find node."
fi

# --------------------------------------------------------- packages that need root
head_ "packages that need root"
SUDO_OK=0; sudo -n true 2>/dev/null && SUDO_OK=1
APT=(); GCLOUD_MISSING=0
for spec in "imagemagick:magick" "shellcheck:shellcheck"; do
  pkg="${spec%%:*}"; bin="${spec##*:}"
  if [ -n "$(bin_of "$bin")" ]; then say "$pkg: already present"; continue; fi
  if [ "$SUDO_OK" = 1 ]; then
    say "$pkg: installing with sudo"
    if [ "$DRY" = 1 ] || sudo apt-get install -y "$pkg" >/dev/null 2>&1; then say "  ok"; else say "  failed"; APT+=("$pkg"); fi
  else
    say "$pkg: needs root"; APT+=("$pkg")
  fi
done
[ -z "$(bin_of gcloud)" ] && { say "gcloud: not installed"; GCLOUD_MISSING=1; } || say "gcloud: already present"

if [ "${#APT[@]}" -gt 0 ] || [ "$GCLOUD_MISSING" = 1 ]; then
  printf '\n  Could not install (no passwordless sudo). Run this yourself:\n'
  [ "${#APT[@]}" -gt 0 ] && printf '    sudo apt-get update && sudo apt-get install -y %s\n' "${APT[*]}"
  [ "$GCLOUD_MISSING" = 1 ] && printf '    gcloud: follow Google'"'"'s apt-repository instructions (it is not a stock package)\n'
fi

# ----------------------------------------------------------------- verification
head_ "verification"
FAIL=0
check() {  # $1 label, $2 binary, $3 args, $4 hard?
  local p out rc
  p="$(bin_of "$2")"
  if [ -z "$p" ]; then
    printf '  %s  %-12s %s\n' "$([ "${4:-}" = hard ] && echo FAIL || echo 'warn')" "$1" "not found"
    if [ "${4:-}" = hard ]; then FAIL=1; fi
    return
  fi
  set +e
  # Run with the known tool directories on PATH. Two reasons: npm and anything else
  # with a `#!/usr/bin/env node` shebang cannot start without node on PATH even
  # though it sits right beside it, and apkanalyzer/aapt2 need java. Reporting a
  # present tool as missing is the same failure as reporting a missing one as
  # present, so the check runs in the environment the script actually creates.
  out="$(PATH="$(dirname "$p"):$HOME/jdk-21/bin:$HOME/Android/Sdk/platform-tools:$PATH" "$p" $3 2>&1)"; rc=$?
  set -e
  out="${out%%$'\n'*}"
  if [ "$rc" = 0 ] && [ -n "$out" ]; then
    printf '  PASS  %-12s %s\n' "$1" "$out"
  else
    printf '  %s  %-12s %s\n' "$([ "${4:-}" = hard ] && echo FAIL || echo 'warn')" "$1" "failed: $out"
    if [ "${4:-}" = hard ]; then FAIL=1; fi
  fi
}
check node        node        "-v"                                             hard
check npm         npm         "-v"                                             soft
check python3     python3     "-V"                                             soft
check java        java        "-version"                                       hard
check keytool     keytool     "-help"                                          soft
check jarsigner   jarsigner   "-help"                                          soft
check apkanalyzer apkanalyzer "version"                                      soft
check adb         adb         "version"                                        soft
check docker      docker      "--version"                                      hard
check gh          gh          "--version"                                      soft
check git         git         "--version"                                      soft
check ffmpeg      ffmpeg      "-version"                                       soft
check magick      magick      "-version"                                       soft
check shellcheck  shellcheck  "--version"                                      soft
# The tool this script installs must appear in the verification pass, or the script
# can report "all required tools present" while the one thing it added is broken.
check bundletool "$PREFIX/bundletool" "version"                                       soft

printf '\n'
if [ "$FAIL" = 1 ]; then
  echo "one or more REQUIRED tools are missing — see FAIL above"; exit 1
fi
echo "build host: all required tools present."
