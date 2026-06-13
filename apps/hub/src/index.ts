/**
 * @twitch-room/hub
 *
 * The single public service Viewers reach first. It is a DIRECTORY, not a relay:
 * it tracks which Rooms exist, their presence, and each Room's Public Endpoint,
 * then redirects Viewers to that endpoint and gets out of the data path
 * (CONTEXT.md, ADR-0001). One Hub serves many Rooms.
 *
 * Boot sequence: load+validate config -> connect Postgres + migrate -> build
 * Fastify (cors, cookie, route plugins) -> start the presence sweeper -> listen.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { PROTOCOL_VERSION } from '@twitch-room/protocol';

import { config } from './config.js';
import { migrate, pool } from './db.js';
import { sweepOffline } from './directory.js';
import { authRoutes } from './routes/auth.js';
import { roomsRoutes } from './routes/rooms.js';
import { redirectRoutes } from './routes/redirect.js';

async function main(): Promise<void> {
  // Fail fast if the database is unreachable, then ensure the schema exists.
  await migrate();

  const app = Fastify({ logger: true });

  await app.register(cors, {
    // The public directory listing is safe to read cross-origin.
    origin: true,
  });
  await app.register(cookie);

  // Order matters: API and auth routes first; the catch-all /:channel redirect
  // is registered LAST so it never shadows /api/* or /auth/*.
  await app.register(authRoutes);
  await app.register(roomsRoutes);
  await app.register(redirectRoutes);

  // Presence sweeper: flip stale 'online' Rooms to 'offline' on an interval well
  // below the timeout so directory state converges quickly after a Room drops.
  const sweepEvery = Math.max(1000, Math.floor(config.presenceTimeoutMs / 3));
  const sweeper = setInterval(() => {
    sweepOffline(config.presenceTimeoutMs).catch((err: unknown) => {
      app.log.error({ err }, 'presence sweep failed');
    });
  }, sweepEvery);
  sweeper.unref();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`[hub] received ${signal}, shutting down`);
    clearInterval(sweeper);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(
    `[hub] directory online on :${config.port} (protocol v${PROTOCOL_VERSION}) — public url ${config.hubPublicUrl}`,
  );
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[hub] fatal during startup:', err);
  process.exit(1);
});
