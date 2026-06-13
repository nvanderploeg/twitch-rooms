/**
 * Directory API routes (Room Server <-> Hub).
 *
 *   POST /api/rooms/register   (Bearer) -> upsert directory entry
 *   POST /api/rooms/heartbeat  (Bearer) -> refresh presence
 *   GET  /api/rooms                      -> list online Rooms (public)
 *
 * The Bearer token proves Twitch channel ownership (issued via the auth flow).
 * For register/heartbeat the token's channel MUST match the body's channel.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type {
  HeartbeatRequest,
  RegisterRequest,
  RegisterResponse,
  RoomDirectoryEntry,
} from '@twitch-room/protocol';
import { PROTOCOL_VERSION } from '@twitch-room/protocol';

import { config } from '../config.js';
import { upsertRegistration, touchHeartbeat, listOnline } from '../directory.js';
import { verifyRegistrationToken } from '../tokens.js';

/** Channel resolved from the Bearer token, attached by the preHandler. */
declare module 'fastify' {
  interface FastifyRequest {
    tokenChannel?: string;
  }
}

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** preHandler: require a valid registration token and stash its channel. */
async function requireRegistrationToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractBearer(request);
  if (!token) {
    await reply.code(401).send({ ok: false, error: 'missing bearer token' });
    return;
  }
  const channel = await verifyRegistrationToken(token);
  if (!channel) {
    await reply.code(401).send({ ok: false, error: 'invalid registration token' });
    return;
  }
  request.tokenChannel = channel;
}

export const roomsRoutes: FastifyPluginAsync = async (app) => {
  // --- Authenticated writes ---
  app.post<{ Body: RegisterRequest }>(
    '/api/rooms/register',
    { preHandler: requireRegistrationToken },
    async (request, reply) => {
      const body = request.body;
      if (request.tokenChannel !== body.channel) {
        return reply
          .code(403)
          .send({ ok: false, error: 'token channel does not match request channel' });
      }
      if (body.protocolVersion !== PROTOCOL_VERSION) {
        // TODO: decide compatibility policy (reject vs. accept-with-warning) for
        // mismatched protocol versions. For now we accept and record what was sent.
        request.log.warn(
          { got: body.protocolVersion, hub: PROTOCOL_VERSION },
          'room registered with mismatched protocol version',
        );
      }

      await upsertRegistration(body);
      const response: RegisterResponse = {
        ok: true,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
      };
      return reply.send(response);
    },
  );

  app.post<{ Body: HeartbeatRequest }>(
    '/api/rooms/heartbeat',
    { preHandler: requireRegistrationToken },
    async (request, reply) => {
      const body = request.body;
      if (request.tokenChannel !== body.channel) {
        return reply
          .code(403)
          .send({ ok: false, error: 'token channel does not match request channel' });
      }
      await touchHeartbeat(body.channel);
      return reply.send({ ok: true });
    },
  );

  // --- Public read ---
  app.get('/api/rooms', async (_request, reply) => {
    const rooms: RoomDirectoryEntry[] = await listOnline();
    return reply.send(rooms);
  });
};
