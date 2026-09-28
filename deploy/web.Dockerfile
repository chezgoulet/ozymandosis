# ozymandosis.com + www: the static site, with the web client at /play/, served by Caddy.
#   docker build -f deploy/web.Dockerfile -t ozymandosis-web .
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm install --no-save --no-package-lock esbuild@0.25 && node tools/build-web.cjs && node apps/site/build.cjs

FROM caddy:2-alpine
ARG REVISION=dev
LABEL org.opencontainers.image.revision=$REVISION
COPY --from=build /app/apps/site/dist /srv/site
COPY deploy/Caddyfile /etc/caddy/Caddyfile
