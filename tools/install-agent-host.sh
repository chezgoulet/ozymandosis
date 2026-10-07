#!/usr/bin/env bash
# Install what the AGENT HOST needs to run the release automation.
#
#   Where: mikoa — the ODROID-H3-class x86 board the agent runs on
#          (hostname mikoa, Ubuntu 26.04, Intel Pentium Silver N6005, x86_64).
#   Usage: bash tools/install-agent-host.sh [--dry-run] [--prefix DIR]
#
# Idempotent, and it ends with a verification pass rather than assuming success.
#
# It does NOT install a vault client: the Hermes integration provides its own. 1Password
# is the only one that needs help, because it publishes no user-level binary.
# manager at process start rather than written into a file on this machine. It
# deliberately does NOT sign in: that needs your master password and is a human step.
# This script never sees a credential value.
set -euo pipefail

DRY=0; PREFIX="$HOME/.local/bin"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --prefix)  PREFIX="${2:?--prefix needs a directory}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)  ARCHTAG="amd64"; EXCLUDE_ARM='arm64|aarch64|arm[-_]' ;;
  aarch64|arm64) ARCHTAG="arm64"; EXCLUDE_ARM='amd64|x86_64' ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

say()   { printf '  %s\n' "$*"; }
head_() { printf '\n== %s ==\n' "$*"; }
have()  { command -v "$1" >/dev/null 2>&1; }

# Where a tool actually is: PATH first, then the known home locations. Detection
# never trusts PATH alone.
bin_of() {
  local t="$1" p c
  p="$(command -v "$t" 2>/dev/null || true)"
  if [ -z "$p" ]; then
    for c in "$HOME/.local/bin/$t" "$HOME/bin/$t" "$HOME/.hermes/node/bin/$t" "$HOME/.hermes/bin/$t"; do
      [ -x "$c" ] && { p="$c"; break; }
    done
  fi
  printf '%s' "$p"
}

# See install-build-host.sh for why this resolves the URL from the API instead of
# building it from /releases/latest/download/ — that shortcut is what returned 404,
# because "latest" for this repository is the desktop release, not the CLI.
resolve_asset() {  # $1=repo  $2=name include regex  $3=name exclude regex
  gh api "repos/$1/releases?per_page=30" --jq \
    '.[] | select(.prerelease==false) | .assets[] | "\(.name)\t\(.browser_download_url)"' 2>/dev/null \
  | awk -v inc="$2" -v exc="${3:-}" -F'\t' '{ if ($1 ~ inc && (exc=="" || $1 !~ exc)) { print $1 "\t" $2; exit } }'
}

printf 'agent host setup — %s, %s (%s), prefix %s%s\n' \
  "$(hostname)" "$ARCH" "$ARCHTAG" "$PREFIX" "$([ "$DRY" = 1 ] && echo ' — DRY RUN')"

# ---------------------------------------------------------------- already there
head_ "already present (these carry the API and repo work)"
for t in node npm python3 pip3 jq curl openssl unzip git gh age; do
  p="$(command -v "$t" 2>/dev/null || true)"; printf '  %-10s %s\n' "$t" "${p:-MISSING}"
done

# ------------------------------------------------- vault client: nothing to do here
head_ "vault client"
say "not installed by hand. The Hermes integration installs and verifies its own:"
say "  hermes secrets bitwarden setup      # installs bws (pinned v2.0.0), stores the token, picks a project"
say "This script used to download the Bitwarden *desktop* CLI (bw) here, which the"
say "integration does not use. 1Password is the exception: it publishes no user-level"
say "binary, so that one needs the apt install printed below."

# --------------------------------------------------------------- 1Password CLI (op)
head_ "1Password CLI — needs root on Debian/Ubuntu"
if have op; then
  say "already installed: $(op --version 2>/dev/null | head -1)"
else
  printf '  Not installed. 1Password publishes no user-level binary; run:\n'
  printf '    curl -sS https://downloads.1password.com/linux/keys/1password.asc | \\\n'
  printf '      sudo gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg\n'
  printf '    echo "deb [arch=%s signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/%s stable main" | \\\n' "$ARCHTAG" "$ARCHTAG"
  printf '      sudo tee /etc/apt/sources.list.d/1password.list\n'
  printf '    sudo apt-get update && sudo apt-get install -y 1password-cli\n'
fi

# -------------------------------------------------------------------- shellcheck
head_ "shellcheck"
if have shellcheck; then say "already present"
else printf '  Not installed. Run:  sudo apt-get install -y shellcheck\n'; fi

# -------------------------------------------------------------------- next step
head_ "after this"
printf '  Whichever vault client you install, wire it in with:\n'
printf '    hermes secrets bitwarden      # or: hermes secrets onepassword\n'
printf '  Then sign in yourself. The master password is not this script'"'"'s business, and\n'
printf '  no credential value should pass through a shell history or a chat.\n'

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
  # Run with the known tool directories on PATH: npm and anything else with a
  # `#!/usr/bin/env node` shebang cannot start without node on PATH even though it
  # sits right beside it, and the node-dependent tools need it too. Reporting a
  # present tool as missing is the same failure as reporting a missing one as
  # present.
  out="$(PATH="$(dirname "$p"):$HOME/.hermes/node/bin:$HOME/jdk-21/bin:$PATH" "$p" $3 2>&1)"; rc=$?
  set -e
  out="${out%%$'\n'*}"                      # first line, without a pipe
  if [ "$rc" = 0 ] && [ -n "$out" ]; then
    printf '  PASS  %-12s %s\n' "$1" "$out"
  else
    printf '  %s  %-12s %s\n' "$([ "${4:-}" = hard ] && echo FAIL || echo 'warn')" "$1" "failed: $out"
    if [ "${4:-}" = hard ]; then FAIL=1; fi
  fi
}
check node       node       "-v"              hard
check npm        npm        "-v"              soft
check python3    python3    "-V"              soft
check jq         jq         "--version"       hard
check curl       curl       "--version"       hard
check openssl    openssl    "version"         soft
check unzip      unzip      "-v"              hard
check git        git        "--version"       hard
check gh         gh         "--version"       hard
check age        age        "--version"       soft
# Not `bw`: the integration uses bws, which it installs itself. Report it if present,
# and let `hermes secrets bitwarden status` be the authority on whether it is wired up.
check bws        bws        "--version"       soft
check op         op         "--version"       soft
check shellcheck shellcheck "--version"       soft

printf '\n'
if [ "$FAIL" = 1 ]; then
  echo "one or more REQUIRED tools are missing — see FAIL above"; exit 1
fi
echo "agent host: all required tools present."
