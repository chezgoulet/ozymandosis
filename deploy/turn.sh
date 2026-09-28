#!/bin/sh
# coturn with TLS certificates that follow Caddy's renewals.
# Caddy issues and renews turn.$DOMAIN (Let's Encrypt, or ZeroSSL as fallback);
# coturn reads certificates once at start, so this wrapper finds the newest
# pair, starts turnserver, and sends SIGUSR2 (reload TLS) whenever it changes.
# Caddy's keys are root-only: this wrapper runs as root, copies the pair into a
# private directory owned by coturn's user, and turnserver drops to that user.
set -eu
: "${DOMAIN:?DOMAIN is required}"
HOSTNAME_TLS="turn.$DOMAIN"
find_cert() { find /caddy/caddy/certificates -type f -name "$HOSTNAME_TLS.crt" 2>/dev/null | xargs -r ls -1t 2>/dev/null | head -n 1; }
digest() { cat "$1" "${1%.crt}.key" 2>/dev/null | sha256sum | cut -d' ' -f1; }
RUN_DIR=/run/turn-tls
install_pair() {
  mkdir -p "$RUN_DIR"; chown nobody:nogroup "$RUN_DIR"; chmod 700 "$RUN_DIR"
  install -o nobody -g nogroup -m 0400 "$1" "$RUN_DIR/cert.pem.new" && mv -f "$RUN_DIR/cert.pem.new" "$RUN_DIR/cert.pem"
  install -o nobody -g nogroup -m 0400 "${1%.crt}.key" "$RUN_DIR/key.pem.new" && mv -f "$RUN_DIR/key.pem.new" "$RUN_DIR/key.pem"
}

cert="$(find_cert)"
while [ -z "$cert" ] || [ ! -s "${cert%.crt}.key" ]; do
  echo "turn: waiting for Caddy to issue $HOSTNAME_TLS"
  sleep 15
  cert="$(find_cert)"
done
echo "turn: using $cert"
install_pair "$cert"

turnserver "$@" --cert="$RUN_DIR/cert.pem" --pkey="$RUN_DIR/key.pem" --proc-user=nobody --proc-group=nogroup &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null; wait "$pid"; exit 0' TERM INT
seen="$(digest "$cert")"

while kill -0 "$pid" 2>/dev/null; do
  sleep "${TURN_CERT_CHECK_S:-3600}" & wait $! || true
  now="$(find_cert)"
  [ -n "$now" ] || continue
  # a renewal, or a different issuer's directory: copy the newest pair and reload in place
  d="$(digest "$now")"
  if [ "$d" != "$seen" ]; then echo "turn: certificate renewed ($now), reloading"; install_pair "$now"; kill -USR2 "$pid"; seen="$d"; cert="$now"; fi
done
wait "$pid"
