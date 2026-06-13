/**
 * @twitch-room/hub
 *
 * The single public service that Viewers reach. It holds a live outbound
 * connection from each Room Server and relays Viewers through it, so Streamers
 * never expose an inbound port. One Hub serves many Rooms.
 */
import { PROTOCOL_VERSION } from '@twitch-room/protocol';

// TODO(decision pending): HTTP/web framework (Fastify vs Express vs raw http) is
// undecided — no server framework is wired up yet.
// TODO(decision pending): realtime transport (WebRTC/WebSocket stack) for the
// Viewer <-> Hub and Hub <-> Room Server links is undecided.

function main(): void {
  console.log(`[hub] starting (protocol v${PROTOCOL_VERSION})`);
}

main();
