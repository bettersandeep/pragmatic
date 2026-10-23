# syntax=docker/dockerfile:1
# Multi-arch image (linux/amd64, linux/arm64). Base images come from ECR Public to avoid Docker Hub rate limits.
ARG NODE=public.ecr.aws/docker/library/node:24-bookworm-slim

# The web app is plain JS and CSS, so it is built once on the build machine's own architecture.
FROM --platform=$BUILDPLATFORM ${NODE} AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY web web
COPY shared shared
# The Claude Desktop extension is served at /pragmatic.mcpb.
COPY claude-desktop claude-desktop
RUN npm run build

FROM ${NODE}
# Chromium renders board pictures (Drive copies, export_board).
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates \
  && rm -rf /var/lib/apt/lists/* && mkdir -p /data/files && chown -R node:node /data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server server
COPY shared shared
COPY --from=web /app/dist dist
# /data holds everything: the built-in database (when DATABASE_URL is unset), uploaded images, the key file.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100 PRAGMATIC_DATA=/data \
    CHROME_PATH=/usr/bin/chromium CHROME_NO_SANDBOX=1 RENDER_URL=http://127.0.0.1:3100
USER node
EXPOSE 3100
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3100/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/main.ts"]
