/**
 * Viewer-facing redirect route.
 *
 *   GET /:channel -> if the Room is online, 302 to its Public Endpoint;
 *                    otherwise 404 with a tiny "offline / not found" page.
 *
 * This is the Hub's whole job at the edge: send the Viewer to the Streamer's own
 * Public Endpoint, then get out of the data path (ADR-0001).
 *
 * IMPORTANT: this plugin owns the catch-all `/:channel` param route and must be
 * registered LAST so it does not shadow `/api/*` or `/auth/*`.
 */
import type { FastifyPluginAsync } from 'fastify';

import { getRoom } from '../directory.js';

interface ChannelParams {
  channel: string;
}

function offlinePage(channel: string): string {
  const safe = channel.replace(/[<>&"]/g, '');
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Room offline</title></head>
  <body style="font-family: system-ui; max-width: 32rem; margin: 4rem auto; text-align: center;">
    <h1>Room offline or not found</h1>
    <p>No online Room for <code>${safe}</code> right now.</p>
  </body>
</html>`;
}

export const redirectRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: ChannelParams }>('/:channel', async (request, reply) => {
    const { channel } = request.params;
    const room = await getRoom(channel);

    if (room && room.presence === 'online') {
      return reply.redirect(room.publicEndpoint, 302);
    }

    return reply.code(404).type('text/html').send(offlinePage(channel));
  });
};
