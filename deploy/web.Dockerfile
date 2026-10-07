# ozymandosis.com + www: the static site, served by Caddy. There is no browser version
# of the game (docs/MONETIZATION.md); the site links to F-Droid and Obtainium.
#   docker build -f deploy/web.Dockerfile -t ozymandosis-web .
# The apex is served by GitHub Pages from chezgoulet/ozymandosis-site; this container is
# the game files and the API proxy (see deploy/Caddyfile).

FROM caddy:2-alpine
ARG REVISION=dev
LABEL org.opencontainers.image.revision=$REVISION
COPY deploy/Caddyfile /etc/caddy/Caddyfile
