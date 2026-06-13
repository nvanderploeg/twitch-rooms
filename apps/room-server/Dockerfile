# Room Server image.
#
# NOTE: this image runs the Room Server only. It expects the BUILT WEB CLIENT to
# be available at WEB_DIST (default: the sibling apps/web/dist baked in below).
# The web client is served at the same origin as the wss:// data (ADR-0001).
#
# Persistent data is NOT in the image: the SQLite file lives at ${DATA_DIR}/room.db
# on a host bind mount (ADR-0004). See docker-compose.yml.

FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# pnpm via corepack (matches the monorepo toolchain).
RUN corepack enable

# ---- build stage: install workspace deps and compile TS ----
FROM base AS build
ENV NODE_ENV=development
# Copy the whole monorepo so workspace deps (@twitch-room/protocol) resolve.
COPY . .
RUN pnpm install --frozen-lockfile
# Build the protocol package, the web client, then the room server.
RUN pnpm --filter @twitch-room/protocol build \
 && pnpm --filter @twitch-room/web build \
 && pnpm --filter @twitch-room/room-server build

# ---- runtime stage ----
FROM base AS runtime
# Bring over the built monorepo (node_modules + dist of the relevant packages).
COPY --from=build /app /app
# Default web client location inside the image.
ENV WEB_DIST=/app/apps/web/dist
ENV DATA_DIR=/data
WORKDIR /app/apps/room-server
EXPOSE 8080
CMD ["node", "dist/index.js"]
