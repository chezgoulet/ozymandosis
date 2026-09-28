# play.ozymandosis.com — build from the repository root:
#   docker build -f apps/play/Dockerfile -t ozymandosis-play .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/play/package.json apps/play/
COPY apps/site/package.json apps/site/
RUN npm ci --workspace apps/play --include-workspace-root=false --ignore-scripts=false
COPY apps/play apps/play
RUN npm run build --workspace apps/play && npm prune --omit=dev --workspace apps/play --include-workspace-root=false

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 TRUST_PROXY=true
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/play/dist apps/play/dist
COPY apps/play/package.json apps/play/
COPY apps/play/public apps/play/public
COPY apps/play/src/db/migrations apps/play/dist/db/migrations
COPY vendor/fonts apps/play/public-fonts
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "apps/play/dist/index.js"]
