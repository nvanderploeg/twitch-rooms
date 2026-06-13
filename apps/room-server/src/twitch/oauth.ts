/**
 * Streamer OAuth for the Room Server config panel.
 *
 * Only the Streamer who owns this Room may edit its Room Config. We prove that
 * by having them authenticate with Twitch (ADR-0002: identity is the Twitch
 * login) and checking the resulting login equals `config.channel`. A successful
 * login establishes a streamer session cookie that gates the config-write API.
 *
 * `@fastify/cookie` is not a dependency of this app, so the session cookie is
 * set/read via raw headers. The session store is in-memory (single process).
 */
import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config.js';

/** Name of the streamer session cookie. */
const SESSION_COOKIE = 'rs_session';

const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

/** Scopes the Room Server needs: read identity + read the channel's chat. */
const SCOPES = ['user:read:email', 'user:read:chat'];

/** A live streamer session. In v1 there is at most one (the Streamer). */
interface Session {
  login: string;
  createdAt: number;
}

/** In-memory session store keyed by opaque session id. */
const sessions = new Map<string, Session>();
/** Outstanding OAuth `state` values to defend against CSRF on the callback. */
const pendingStates = new Set<string>();

/** Parse a Cookie header into a name->value map. */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) {
      continue;
    }
    const name = part.slice(0, idx).trim();
    out[name] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/**
 * Whether the request carries a valid streamer session. Used by the config
 * write route to gate mutations.
 */
export function isStreamer(req: FastifyRequest): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) {
    return false;
  }
  const session = sessions.get(sid);
  return session?.login === config.channel;
}

/** Register the Streamer OAuth routes. */
export function oauthRoutes(app: FastifyInstance): void {
  // Kick off the Twitch authorization code flow.
  app.get('/auth/twitch/login', (_req: FastifyRequest, reply: FastifyReply) => {
    const state = randomBytes(16).toString('hex');
    pendingStates.add(state);
    const params = new URLSearchParams({
      client_id: config.twitchClientId,
      redirect_uri: config.twitchRedirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
    });
    reply.redirect(`${TWITCH_AUTHORIZE_URL}?${params.toString()}`);
  });

  // Twitch redirects back here with ?code & ?state.
  app.get(
    '/auth/twitch/callback',
    async (
      req: FastifyRequest<{ Querystring: { code?: string; state?: string } }>,
      reply: FastifyReply,
    ) => {
      const { code, state } = req.query;
      if (!state || !pendingStates.delete(state)) {
        return reply.code(400).send('invalid or expired oauth state');
      }
      if (!code) {
        return reply.code(400).send('missing authorization code');
      }

      // TODO: exchange `code` for tokens at TWITCH_TOKEN_URL, then call Helix
      // /users with the access token to read the authenticated login. Verify it
      // equals config.channel before issuing a session. Persist the user token
      // (db.ts) so twitch/eventsub.ts can create the chat subscription.
      const login = await exchangeAndIdentify(code);
      if (login !== config.channel) {
        return reply.code(403).send('authenticated Twitch login does not own this Room');
      }

      const sid = randomBytes(24).toString('hex');
      sessions.set(sid, { login, createdAt: Date.now() });
      reply.header(
        'set-cookie',
        `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Secure`,
      );
      return reply.redirect('/');
    },
  );
}

/**
 * Exchange the authorization code for tokens and return the authenticated Twitch
 * login. Credential-dependent; stubbed until the Twitch app is configured.
 */
async function exchangeAndIdentify(code: string): Promise<string> {
  // TODO: real implementation —
  //   POST TWITCH_TOKEN_URL with grant_type=authorization_code, client_id,
  //   client_secret, code, redirect_uri; then GET Helix /users with the token.
  //   Store the resulting user access/refresh tokens for EventSub.
  void code;
  void TWITCH_TOKEN_URL;
  console.warn('[oauth] token exchange is stubbed; returning configured channel');
  // Returning config.channel keeps the stub path usable in dev without Twitch.
  return config.channel;
}
