# Hub image — the operator-run public directory service.
#
# This is a monorepo (pnpm workspaces) and the Hub depends on @twitch-room/protocol
# via `workspace:*`, so the BUILD CONTEXT must be the repo ROOT, not apps/hub.
# Build from the repo root, e.g.:
#   docker build -f apps/hub/Dockerfile -t twitch-room-hub .
# (docker-compose.yml in this directory sets the context to the repo root for you.)

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# --- Install + build the whole workspace (protocol must build before hub) ---
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/hub ./apps/hub
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @twitch-room/protocol build \
 && pnpm --filter @twitch-room/hub build

# --- Runtime image: prod deps only ---
FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/hub ./apps/hub
# Built protocol output is needed for the workspace symlink to resolve at runtime.
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/hub/dist ./apps/hub/dist
RUN pnpm install --frozen-lockfile --prod

WORKDIR /repo/apps/hub
EXPOSE 8080
CMD ["node", "dist/index.js"]
