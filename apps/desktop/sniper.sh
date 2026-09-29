#!/usr/bin/env bash
# Run a command inside Steam Linux Runtime 3.0 (sniper): the same pressure-vessel
# container Steam starts for a depot marked "sniper". With no command, runs the
# packaged Linux build (npm run package) the way Steam's launch option does.
# The working directory is the build.
#   ./sniper.sh                       the game
#   ./sniper.sh --foo                 the game, with more switches
#   ./sniper.sh ldd ./ozymandosis     anything else, in the container
# The runtime is pinned and checksummed, downloaded once to ~/.cache/steamrt.
set -euo pipefail

VERSION=3.0.20260805.254768
SHA256=e264f0639ab775338311036f207b35cebe99bc417b016b53931ebca8b30b3d94
# The Steamworks launch option, exactly: executable `ozymandosis`, these arguments.
# X11 because Electron otherwise picks Wayland on a Wayland desktop and crashes in
# the container, and the Steam overlay hooks X11 (docs/STORES.md).
LAUNCH=(./ozymandosis --ozone-platform=x11)
URL="https://repo.steampowered.com/steamrt-images-sniper/snapshots/$VERSION/SteamLinuxRuntime_sniper.tar.xz"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="${OZY_APP:-$here/dist/linux-unpacked}"
cache="${STEAMRT_CACHE:-$HOME/.cache/steamrt}/$VERSION"
rt="$cache/SteamLinuxRuntime_sniper"

if [ ! -x "$rt/run" ]; then
  mkdir -p "$cache"
  echo "sniper: downloading Steam Linux Runtime $VERSION" >&2
  curl -fsSL -o "$cache/rt.tar.xz" "$URL"
  echo "$SHA256  $cache/rt.tar.xz" | sha256sum -c --quiet -
  tar -C "$cache" -xf "$cache/rt.tar.xz" && rm "$cache/rt.tar.xz"
fi
[ -x "$app/ozymandosis" ] || { echo "sniper: no build at $app (run npm run package)" >&2; exit 1; }

# Ubuntu 23.10+ lets only AppArmor profiles that allow it create user namespaces,
# which the container needs. Steam itself runs under the "steam" profile the
# steam package installs; run under the same one.
wrap=()
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = 1 ]; then
  aa-exec -p steam -- true 2>/dev/null || { echo "sniper: user namespaces are restricted and there is no 'steam' AppArmor profile (install the steam package)" >&2; exit 1; }
  wrap=(aa-exec -p steam --)
fi

cd "$app"
if [ $# -eq 0 ] || [ "${1:0:1}" = - ]; then set -- "${LAUNCH[@]}" "$@"; fi
exec "${wrap[@]}" "$rt/run" -- "$@"
