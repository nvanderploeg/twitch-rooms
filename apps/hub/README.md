# @twitch-room/hub

The **Hub** is the single public service Viewers reach first. It is a
**directory + redirect**, not a relay:

- It tracks which Rooms exist, their presence (online/offline), and each Room's
  **Public Endpoint**.
- When a Viewer visits `hub/:channel`, the Hub **redirects** them to that Room's
  Public Endpoint and then gets out of the way.
- It carries **no live Room traffic** — chat and gameplay flow directly between
  Viewer and the Streamer's Room Server (see `docs/adr/0001`).

A **Room == a Twitch channel**. A Streamer proves ownership via Twitch OAuth and
receives a **registration token**, which their Room Server uses as a Bearer token
to register and heartbeat with the Hub (see `docs/adr/0002`).

The Hub is **operator-run**: one Hub serves many Rooms.

## Run

```bash
cp .env.example .env   # then fill in Twitch credentials etc.
docker compose up      # starts `hub` + a Postgres `db`
```

The schema is created automatically on boot (`migrate()` is idempotent).

## Endpoints

### Streamer OAuth (browser)
- `GET /auth/twitch/login` — redirects the Streamer to Twitch to prove channel
  ownership.
- `GET /auth/twitch/callback` — verifies the login and displays the registration
  token to paste into the Room Server config.

### Directory API (Room Server → Hub, Bearer auth)
- `POST /api/rooms/register` — body `RegisterRequest`; upserts the directory
  entry and returns `RegisterResponse` (`{ ok, heartbeatIntervalMs }`).
  The Bearer token's channel must match the body's `channel`.
- `POST /api/rooms/heartbeat` — body `HeartbeatRequest`; keeps the Room online.
- `GET /api/rooms` — public list of online Rooms (`RoomDirectoryEntry[]`).

### Viewer
- `GET /:channel` — `302` to the Room's Public Endpoint if online; otherwise
  `404` with a small "Room offline / not found" page.

## Configuration

See `.env.example` for every variable. `DATABASE_URL` is required; the process
exits with a clear config error if it (or any other required var) is missing.

## Status / TODO

This is a scaffold. The real Twitch token exchange in `src/twitch.ts` and the
OAuth scope set are marked with `// TODO:` and require valid Twitch app
credentials to function end-to-end.
