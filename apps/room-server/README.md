# Room Server (`@twitch-room/room-server`)

The software a **Streamer** self-hosts. It owns the authoritative state of
**one Room** and, at the Streamer's **Public Endpoint**, serves both the web
client and the live `wss://` data on the same origin. It ingests the channel's
Twitch chat via EventSub, turns chatters into avatars, and registers itself with
the directory **Hub** so Viewers can find it.

> No Room Server, no Room. The Hub is only a directory — it redirects a Viewer to
> your Public Endpoint and is never in the data path (ADR-0001).

## How a Streamer runs it

```bash
cp apps/room-server/.env.example apps/room-server/.env
# edit .env: CHANNEL, PUBLIC_ENDPOINT, HUB_URL, REGISTRATION_TOKEN, TWITCH_* …
cd apps/room-server
docker compose up --build
```

This starts a single container. There is **no database service** — the Room
Server uses embedded SQLite (ADR-0004); persistent data is the host-mounted file
`./data/room.db` (back it up by copying it).

### Bring-your-own Public Endpoint + TLS (ADR-0001)

You own the Public Endpoint: its DNS, its TLS certificate, and its reachability
(VPS, port-forward + cert, or a self-run tunnel). Put a TLS-terminating reverse
proxy in front of the container and point `PUBLIC_ENDPOINT` at it as a `wss://`
URL. Because Viewers load the client over HTTPS, **a bare home IP or `ws://`
will be blocked by the browser** — valid `wss://` with a trusted cert is
required.

### Local pipeline test without Twitch

Set `MOCK_CHAT=1` to run an in-process fake chat source that emits a message
every few seconds, exercising the chat → avatar → broadcast pipeline without
Twitch credentials or a real Hub.

## Endpoints

- `GET /` — the web client (or a placeholder if `WEB_DIST` is missing).
- `GET /ws` — Viewer WebSocket. Send `hello`, receive `welcome`; then `claim` /
  `action`.
- `GET /api/config` — public: the current Room Config.
- `PUT /api/config` — streamer-session-gated: validate, persist, reload, broadcast.
- `GET /auth/twitch/login`, `GET /auth/twitch/callback` — Streamer OAuth.

## Environment variables

See `.env.example` for the authoritative list. Summary:

| Var | Required | Description |
| --- | --- | --- |
| `PORT` | no (8080) | Listen port behind your TLS proxy. |
| `CHANNEL` | yes | Your Twitch login (the Room's directory key). |
| `PUBLIC_ENDPOINT` | yes | Public `wss://` URL Viewers connect to. |
| `HUB_URL` | yes | Base URL of the Hub to register with. |
| `REGISTRATION_TOKEN` | yes | Bearer token authorizing registration. |
| `TWITCH_CLIENT_ID` | yes | Twitch app client id. |
| `TWITCH_CLIENT_SECRET` | yes | Twitch app client secret. |
| `TWITCH_REDIRECT_URI` | yes | OAuth redirect URI (must match the Twitch app). |
| `DATA_DIR` | no (`./data`) | Holds `room.db`. |
| `WEB_DIST` | no | Built web client dir to serve. |
| `MOCK_CHAT` | no (`0`) | `1` to use the dev fake chat source. |

## Status

This is a scaffold. Wired and building, with `// TODO:` markers where logic
depends on external services — chiefly: Twitch OAuth token exchange + Helix
calls, EventSub subscription creation, and `claim` token validation.
