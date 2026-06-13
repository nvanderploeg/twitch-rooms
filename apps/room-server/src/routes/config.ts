/**
 * Room Config HTTP API.
 *
 *   GET /api/config  — public: the current RoomConfig (Viewers also receive it
 *                      in the `welcome` ws message; this is for tooling/preview).
 *   PUT /api/config  — streamer-session-gated: validate, persist, reload the
 *                      Room, and broadcast the updated state to all Viewers.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { RoomConfig } from '@twitch-room/protocol';

import { saveConfig } from '../db.js';
import { isStreamer } from '../twitch/oauth.js';
import type { Room } from '../room.js';
import type { WsHub } from '../net/ws.js';

/**
 * Shallow structural validation of an incoming RoomConfig. Real schema
 * validation (per-module params, theme/scene names) is deferred.
 */
function validateConfig(input: unknown): input is RoomConfig {
  if (typeof input !== 'object' || input === null) {
    return false;
  }
  const c = input as Partial<RoomConfig>;
  // TODO: validate modules[] entries, theme, scene and per-module params against
  // the engine's module registry before persisting.
  return (
    typeof c.version === 'number' &&
    typeof c.channel === 'string' &&
    typeof c.theme === 'object' &&
    typeof c.scene === 'object' &&
    Array.isArray(c.modules)
  );
}

/** Register the config routes; needs the Room and WsHub to reload + broadcast. */
export function configRoutes(app: FastifyInstance, room: Room, ws: WsHub): void {
  app.get('/api/config', (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send(room.getConfig());
  });

  app.put('/api/config', (req: FastifyRequest, reply: FastifyReply) => {
    if (!isStreamer(req)) {
      return reply.code(401).send({ error: 'streamer session required' });
    }
    if (!validateConfig(req.body)) {
      return reply.code(400).send({ error: 'invalid RoomConfig' });
    }
    const cfg = req.body;
    saveConfig(cfg);
    room.reconfigure(cfg);
    ws.broadcast({ type: 'state', state: room.snapshot() });
    return reply.send({ ok: true });
  });
}
