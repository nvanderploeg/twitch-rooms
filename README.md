# Twitch Room

Vibe code experiment, use at your own risk

A web service where a Twitch **Streamer**'s **Viewers** gather in a shared, configurable
virtual **Room** and experience chat together. The project ships the _harness_ — the Room is
configurable in looks and functionality, not a single fixed game.

See [`CONTEXT.md`](./CONTEXT.md) for the domain language and [`docs/adr/`](./docs/adr) for the
architectural decisions.

## Workspace layout

This is a [pnpm](https://pnpm.io/) workspace monorepo (TypeScript, ESM, Node 24 LTS).

```
apps/
  hub/           Operator-run public directory. Tracks Room presence and redirects
                 each Viewer to the Room's Public Endpoint (ADR-0001). Fastify + Postgres.
  room-server/   The stack a Streamer self-hosts (docker-compose). Owns one Room's
                 authoritative state, ingests Twitch chat (EventSub), registers with the
                 Hub, and serves the web client + wss data at its Public Endpoint.
                 Fastify + embedded node:sqlite (ADR-0004).
  web/           React + PixiJS Engine a Viewer loads in the browser. Reads a RoomConfig
                 and runs built-in Modules (ADR-0003).
packages/
  protocol/      Shared TypeScript wire types for web <-> room-server <-> hub.
```

`packages/protocol` is a `workspace:*` dependency of all three apps.

## Getting started

Requires Node 24 (`nvm use`) and pnpm.

```bash
pnpm install      # link the workspace and generate the lockfile
pnpm build        # build every package
pnpm dev          # run every package's dev script in parallel
pnpm typecheck    # type-check every package
pnpm test         # unit/integration (Vitest)
pnpm test:e2e     # end-to-end (Playwright)
```

To run a Room Server locally against fake chat (no Twitch app needed):

```bash
MOCK_CHAT=1 CHANNEL=alice PUBLIC_ENDPOINT=wss://localhost:8080/ws \
  HUB_URL=http://localhost:8081 REGISTRATION_TOKEN=dev \
  pnpm --filter @twitch-room/room-server dev
```

## Status

Working scaffold: all three apps build, type-check, and pass unit + e2e tests, and the Room
Server serves the built web client end-to-end. The remaining integration points — real Twitch
OAuth token exchange, EventSub subscription creation, Viewer claim-token validation, and the
Module visuals — are wired and typed but stubbed with `// TODO:`.
