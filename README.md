# Twitch Room

Vibe code experiment, use at your own risk

A web service where a Twitch **Streamer**'s **Viewers** gather in a shared, configurable
virtual **Room** and experience chat together. The project ships the _harness_ — the Room is
configurable in looks and functionality, not a single fixed game.

See [`CONTEXT.md`](./CONTEXT.md) for the domain language and the core model.

## Workspace layout

This is a [pnpm](https://pnpm.io/) workspace monorepo (TypeScript, ESM, Node 22 LTS).

```
apps/
  hub/           Public service Viewers reach; presence + connection brokering/signaling.
  room-server/   The stack a Streamer runs locally (docker-compose); owns one Room's
                 authoritative state. Connects outbound to the Hub.
  web/           React + Vite client a Viewer loads in the browser.
packages/
  protocol/      Shared TypeScript message types for web <-> room-server <-> hub.
```

`packages/protocol` is a `workspace:*` dependency of all three apps.

## Getting started

Requires Node 22 (`nvm use`) and pnpm.

```bash
pnpm install      # link the workspace and generate the lockfile
pnpm build        # build every package
pnpm dev          # run every package's dev script in parallel
pnpm typecheck    # type-check every package
```

## Status

Skeleton only. Several architectural choices are still open and are marked in the source with
`// TODO(decision pending): ...` — notably the web rendering engine, the room-server database,
the HTTP framework for hub/room-server, and the realtime transport.
