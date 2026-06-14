/**
 * Streamer OAuth for the Room Server config panel.
 *
 * Only the Streamer who owns this Room may edit its Room Config. We prove that
 * by having them authenticate with Twitch (ADR-0002: identity is the Twitch
 * login) and checking the resulting login equals `config.channel`. A successful
 * login establishes a streamer session cookie that gates the config-write API.
 *
 * The same OAuth grant yields the user access token (with `user:read:chat`) that
 * the EventSub ingest (twitch/eventsub.ts) needs to subscribe to the channel's
 * chat. Those tokens are persisted via db.ts and refreshed on demand by
 * `getValidAccessToken`.
 *
 * `@fastify/cookie` is not a dependency of this app, so the session cookie is
 * set/read via raw headers. The session store is in-memory (single process).
 */
import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config.js';
import { loadTwitchAuth, saveTwitchAuth, type TwitchAuth } from '../db.js';

/** Name of the streamer session cookie. */
const SESSION_COOKIE = 'rs_session';

const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX_USERS_URL = 'https://api.twitch.tv/helix/users';

/** Scopes the Room Server needs: read the channel's chat (EventSub). */
const SCOPES = ['user:read:chat'];

/**
 * Refresh the access token when it is within this window of expiring (or already
 * expired). A minute of slack avoids racing the EventSub subscription against an
 * about-to-expire token.
 */
const REFRESH_SKEW_MS = 60_000;

/** A live streamer session. In v1 there is at most one (the Streamer). */
interface Session {
  login: string;
  createdAt: number;
}

/** In-memory session store keyed by opaque session id. */
const sessions = new Map<string, Session>();
/** Outstanding OAuth `state` values to defend against CSRF on the callback. */
const pendingStates = new Set<string>();

/* ------------------------------------------------------------------ *
 * Twitch response shapes (subset we read).
 * ------------------------------------------------------------------ */

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
  token_type: string;
}

interface HelixUsersResponse {
  data: Array<{ id: string; login: string; display_name: string }>;
}

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
      req: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>,
      reply: FastifyReply,
    ) => {
      const { code, state, error } = req.query;
      if (error) {
        return reply.code(400).send(`twitch authorization failed: ${error}`);
      }
      if (!state || !pendingStates.delete(state)) {
        return reply.code(400).send('invalid or expired oauth state');
      }
      if (!code) {
        return reply.code(400).send('missing authorization code');
      }

      let token: TokenResponse;
      try {
        token = await exchangeCode(code);
      } catch (err) {
        app.log.error({ err }, '[oauth] token exchange failed');
        return reply.code(502).send('failed to exchange authorization code with Twitch');
      }

      let identity: { id: string; login: string };
      try {
        identity = await fetchIdentity(token.access_token);
      } catch (err) {
        app.log.error({ err }, '[oauth] identity lookup failed');
        return reply.code(502).send('failed to resolve Twitch identity');
      }

      // A Streamer may only authenticate their own channel.
      if (identity.login.toLowerCase() !== config.channel) {
        return reply.code(403).send('authenticated Twitch login does not own this Room');
      }

      const record: TwitchAuth = {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        user_id: identity.id,
        login: identity.login.toLowerCase(),
        scopes: token.scope.join(' '),
        expires_at: Date.now() + token.expires_in * 1000,
      };
      saveTwitchAuth(record);

      // Establish the streamer session that gates config writes.
      const sid = randomBytes(24).toString('hex');
      sessions.set(sid, { login: record.login, createdAt: Date.now() });
      reply.header(
        'set-cookie',
        `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Secure`,
      );
      return reply
        .type('text/html')
        .send(
          '<!doctype html><html><head><meta charset="utf-8">' +
            '<title>Twitch Room — connected</title></head>' +
            '<body><h1>Twitch connected</h1>' +
            `<p>Authenticated as <strong>${record.login}</strong>. ` +
            'Chat ingestion will start shortly.</p>' +
            '<p><a href="/">Return to the Room</a></p></body></html>',
        );
    },
  );
}

/**
 * Return a currently-valid access token (refreshing if near/past expiry), along
 * with the broadcaster's Twitch user id. Returns null if the Streamer has not
 * authenticated yet (no stored auth).
 */
export async function getValidAccessToken(): Promise<
  { accessToken: string; userId: string } | null
> {
  const auth = loadTwitchAuth();
  if (!auth) {
    return null;
  }
  if (auth.expires_at - REFRESH_SKEW_MS > Date.now()) {
    return { accessToken: auth.access_token, userId: auth.user_id };
  }

  // Token is expiring/expired; refresh it and re-persist.
  try {
    const refreshed = await refreshToken(auth.refresh_token);
    const record: TwitchAuth = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      user_id: auth.user_id,
      login: auth.login,
      scopes: refreshed.scope.join(' '),
      expires_at: Date.now() + refreshed.expires_in * 1000,
    };
    saveTwitchAuth(record);
    return { accessToken: record.access_token, userId: record.user_id };
  } catch (err) {
    console.error('[oauth] token refresh failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Exchange an authorization code for tokens (grant_type=authorization_code). */
export async function exchangeCode(
  code: string,
  redirectUri: string = config.twitchRedirectUri,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: config.twitchClientId,
    client_secret: config.twitchClientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const res = await fetch(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`token exchange ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Refresh tokens (grant_type=refresh_token). */
async function refreshToken(refresh: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: config.twitchClientId,
    client_secret: config.twitchClientSecret,
    grant_type: 'refresh_token',
    refresh_token: refresh,
  });
  const res = await fetch(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`token refresh ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Resolve the authenticated user's id + login + display name via Helix /users. */
export async function fetchIdentity(
  accessToken: string,
): Promise<{ id: string; login: string; displayName: string }> {
  const res = await fetch(HELIX_USERS_URL, {
    headers: {
      'Client-Id': config.twitchClientId,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`helix /users ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as HelixUsersResponse;
  const user = json.data[0];
  if (!user) {
    throw new Error('helix /users returned no user');
  }
  return { id: user.id, login: user.login, displayName: user.display_name };
}
