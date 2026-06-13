/**
 * Twitch OAuth helpers.
 *
 * The Streamer proves channel ownership via Twitch OAuth (ADR-0002). We use the
 * authorization-code flow: redirect to Twitch, receive a code on callback,
 * exchange it for a token, then read the verified login from /helix/users.
 *
 * Uses Node 22's global `fetch`. Real network calls require valid Twitch app
 * credentials; the wiring is complete and typed, with the credential-dependent
 * parts marked `// TODO:`.
 */
import { config } from './config.js';

const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';

/** Subset of the Twitch token-exchange response we rely on. */
interface TwitchTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string[];
}

/** Subset of a /helix/users entry we rely on. */
interface TwitchUser {
  /** The Twitch login (lowercased handle) — our directory key. */
  login: string;
  id: string;
  display_name: string;
}

interface TwitchUsersResponse {
  data: TwitchUser[];
}

/**
 * Build the Twitch authorize URL the Streamer is redirected to. `state` is an
 * opaque anti-CSRF value we round-trip via a cookie.
 */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.twitchClientId,
    redirect_uri: config.twitchRedirectUri,
    response_type: 'code',
    // TODO: scope the grant to what we actually need. Channel ownership proof
    // needs no scope; chat ingestion (used by the Room Server) needs the chat
    // read scopes. Finalize once the chat-ingest design lands.
    scope: 'user:read:email',
    state,
  });
  return `${TWITCH_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization `code` for the verified Twitch login of the
 * authenticated Streamer.
 *
 * Implements the real request shapes against id.twitch.tv and api.twitch.tv;
 * requires valid TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET to actually succeed.
 */
export async function exchangeCode(code: string): Promise<{ login: string }> {
  // --- Step 1: code -> access token ---
  // TODO: requires real Twitch app credentials. With placeholder creds this
  // call returns a 400 from Twitch.
  const tokenBody = new URLSearchParams({
    client_id: config.twitchClientId,
    client_secret: config.twitchClientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.twitchRedirectUri,
  });

  const tokenRes = await fetch(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });
  if (!tokenRes.ok) {
    throw new Error(`[hub:twitch] token exchange failed: ${tokenRes.status} ${tokenRes.statusText}`);
  }
  const token = (await tokenRes.json()) as TwitchTokenResponse;

  // --- Step 2: access token -> verified login ---
  const usersRes = await fetch(TWITCH_USERS_URL, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token.access_token}`,
      'client-id': config.twitchClientId,
    },
  });
  if (!usersRes.ok) {
    throw new Error(`[hub:twitch] users lookup failed: ${usersRes.status} ${usersRes.statusText}`);
  }
  const users = (await usersRes.json()) as TwitchUsersResponse;

  const user = users.data[0];
  if (!user) {
    throw new Error('[hub:twitch] users lookup returned no authenticated user');
  }
  return { login: user.login };
}
