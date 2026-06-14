/**
 * @twitch-room/room-server
 *
 * The software a Streamer self-hosts (the docker-compose stack). It owns the
 * authoritative state of exactly ONE Room and, at the Streamer's TLS-secured
 * Public Endpoint, serves BOTH the web client and the live `wss://` data on the
 * same origin (ADR-0001). It ingests the channel's Twitch chat via EventSub and
 * registers itself with the directory Hub. No Room Server, no Room.
 *
 * Boot sequence: load config -> open+migrate SQLite, load RoomConfig -> build
 * the Room -> Fastify (cors, websocket, static/web fallback, ws/config/oauth
 * routes) -> start the chat source (Mock or EventSub) wiring chat -> avatar ->
 * broadcast -> register+heartbeat with the Hub -> listen.
 */
import { existsSync } from 'node:fs';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { PROTOCOL_VERSION, type ChatMessage } from '@twitch-room/protocol';

import { config } from './config.js';
import { loadConfig as loadRoomConfig, migrate, openDb, recordClaim } from './db.js';
import { Room } from './room.js';
import { WsHub } from './net/ws.js';
import { configRoutes } from './routes/config.js';
import { getValidAccessToken, oauthRoutes } from './twitch/oauth.js';
import { viewerAuthRoutes } from './twitch/viewer-auth.js';
import { HubClient } from './hub-client.js';
import {
  EventSubChatSource,
  MockChatSource,
  type ChatSource,
} from './twitch/eventsub.js';

async function main(): Promise<void> {
  // 1. Persistence: open the embedded SQLite DB, migrate, load the RoomConfig.
  openDb();
  migrate();
  const roomConfig = loadRoomConfig();

  // 2. The authoritative Room. Claims are persisted to SQLite for reconnect.
  const room = new Room(roomConfig, { persistClaim: recordClaim });

  // 3. HTTP + WebSocket server.
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const ws = new WsHub(room);
  ws.register(app);
  oauthRoutes(app);
  viewerAuthRoutes(app);
  configRoutes(app, room, ws);

  // Whenever Room state changes (chat spawns, moves, idle despawns, config
  // edits), push a fresh full snapshot to every connected Viewer.
  room.onChange(() => {
    ws.broadcast({ type: 'state', state: room.snapshot() });
  });

  // Serve the built web client at the same origin. If the dist is missing
  // (e.g. running the server without building the client), fall back to a tiny
  // placeholder page so the origin still responds.
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist });
    app.log.info(`[room-server] serving web client from ${config.webDist}`);
  } else {
    app.log.warn(`[room-server] WEB_DIST not found at ${config.webDist}; serving placeholder`);
    app.get('/', (_req, reply) => {
      reply.type('text/html').send(
        '<!doctype html><html><head><meta charset="utf-8"><title>Twitch Room</title></head>' +
          '<body><h1>Twitch Room — web client</h1>' +
          '<p>The built web client was not found. Build it and set WEB_DIST.</p></body></html>',
      );
    });
  }

  // 4. Chat pipeline: chat -> avatar -> broadcast the chat event. The resulting
  // state snapshot is broadcast by the room.onChange subscription above.
  const onChat = (msg: ChatMessage): void => {
    room.applyChat(msg);
    ws.broadcast({ type: 'chat', message: msg });
  };
  const chatSource: ChatSource = config.mockChat
    ? new MockChatSource(onChat)
    : new EventSubChatSource(onChat, getValidAccessToken);
  await chatSource.start();

  // Idle-despawn sweep: drop avatars that have gone quiet (see Room.tick). Runs
  // on a short interval; unref'd so it never keeps the process alive on its own.
  const ticker = setInterval(() => room.tick(Date.now()), 1_000);
  ticker.unref();

  // 5. Directory presence: register with the Hub then heartbeat (non-blocking).
  const hub = new HubClient();
  hub.start();

  // 6. Graceful shutdown.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`[room-server] received ${signal}, shutting down`);
    clearInterval(ticker);
    chatSource.stop();
    hub.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // 7. Listen.
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(
    `[room-server] online on :${config.port} (protocol v${PROTOCOL_VERSION}) — ` +
      `channel ${config.channel}, public endpoint ${config.publicEndpoint}` +
      (config.mockChat ? ' [MOCK_CHAT]' : ''),
  );
}

main().catch((err: unknown) => {
  console.error('[room-server] fatal during startup:', err);
  process.exit(1);
});
