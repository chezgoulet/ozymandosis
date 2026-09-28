# ozymandosis.com + www: the static site, served by Caddy. There is no browser version
# of the game (docs/MONETIZATION.md); the site links to the stores.
#   docker build -f deploy/web.Dockerfile -t ozymandosis-web .
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN node apps/site/build.cjs

FROM caddy:2-alpine
ARG REVISION=dev
LABEL org.opencontainers.image.revision=$REVISION
COPY --from=build /app/apps/site/dist /srv/site
COPY deploy/Caddyfile /etc/caddy/Caddyfile
