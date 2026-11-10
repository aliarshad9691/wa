# syntax=docker/dockerfile:1

# Debian (glibc) base so the native modules (better-sqlite3, sharp) use their prebuilt binaries.
ARG NODE_VERSION=22

# ---- deps: full install for the build ----
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: runtime dependencies only ----
FROM deps AS prod-deps
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data

# ffmpeg/ffprobe: voice notes and video thumbnails
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node package.json next.config.ts ./

# SQLite DB + WhatsApp session keys live here; mount a volume on it.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node_modules/.bin/next", "start"]
