/**
 * @twitch-room/room-server
 *
 * The software a Streamer runs locally (the docker-compose stack). It owns the
 * authoritative state of exactly one Room and makes an outbound connection to the
 * Hub rather than accepting inbound connections. No Room Server, no Room.
 */
import { PROTOCOL_VERSION } from '@twitch-room/protocol';

// TODO(decision pending): database engine and driver for persistent Room state is
// undecided. Persistent data will live in a host-mounted `data/` dir (gitignored).
// TODO(decision pending): HTTP/web framework (Fastify vs Express vs raw http) is
// undecided — no server framework is wired up yet.
// TODO(decision pending): realtime transport (WebRTC/WebSocket stack) for the
// outbound link to the Hub is undecided.

function main(): void {
  console.log(`[room-server] starting (protocol v${PROTOCOL_VERSION})`);
}

main();
