/**
 * Viewer (claim) authentication.
 *
 * Anyone may watch a Room anonymously. To *claim* their avatar and gain web-side
 * agency, a Viewer logs in with Twitch — any Twitch user, with no channel-owner
 * check (unlike the Streamer flow in oauth.ts). On success we mint a short-lived,
 * single-use **claim token** and hand it to the SPA via the redirect fragment;
 * the SPA sends it in the `claim` WebSocket message, which the Room Server
 * exchanges for the Viewer's Twitch identity (see net/ws.ts -> consumeClaimToken).
 *
 * Tokens are kept out of any cookie so the SPA can read them; they are single-use
 * and expire quickly, and only authorize controlling an avatar (low stakes).
 */
import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config.js';
import { exchangeCode, fetchIdentity } from './oauth.js';

const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
/** Claim tokens live briefly — just long enough to round-trip into the SPA. */
const CLAIM_TTL_MS = 5 * 60_000;

/** The Twitch identity a claim token resolves to. */
export interface ViewerIdentity {
  userId: string;
  displayName: string;
}

interface ClaimTokenRecord extends ViewerIdentity {
  expiresAt: number;
}

/** Single-use claim tokens, keyed by the opaque token string. */
const claimTokens = new Map<string, ClaimTokenRecord>();
/** Outstanding OAuth `state` values to defend against CSRF on the callback. */
const pendingStates = new Set<string>();

function mintClaimToken(identity: ViewerIdentity): string {
  const token = randomBytes(24).toString('hex');
  claimTokens.set(token, { ...identity, expiresAt: Date.now() + CLAIM_TTL_MS });
  return token;
}

/**
 * Exchange a claim token for the Viewer's identity. Single-use: the token is
 * consumed (deleted) on lookup. Returns null if unknown or expired.
 */
export function consumeClaimToken(token: string): ViewerIdentity | null {
  const record = claimTokens.get(token);
  if (!record) {
    return null;
  }
  claimTokens.delete(token);
  if (record.expiresAt < Date.now()) {
    return null;
  }
  return { userId: record.userId, displayName: record.displayName };
}

/** Register the Viewer OAuth (claim) routes. */
export function viewerAuthRoutes(app: FastifyInstance): void {
  app.get('/auth/viewer/login', (_req: FastifyRequest, reply: FastifyReply) => {
    const state = randomBytes(16).toString('hex');
    pendingStates.add(state);
    const params = new URLSearchParams({
      client_id: config.twitchClientId,
      redirect_uri: config.twitchViewerRedirectUri,
      response_type: 'code',
      // Identity only — claiming an avatar needs no chat/channel scopes.
      scope: '',
      state,
    });
    reply.redirect(`${TWITCH_AUTHORIZE_URL}?${params.toString()}`);
  });

  app.get(
    '/auth/viewer/callback',
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
      try {
        const token = await exchangeCode(code, config.twitchViewerRedirectUri);
        const identity = await fetchIdentity(token.access_token);
        const claimToken = mintClaimToken({
          userId: identity.id,
          displayName: identity.displayName || identity.login,
        });
        // Hand the token to the SPA via the URL fragment (not sent to the server,
        // not logged). The client reads it and sends a `claim` message.
        return reply.redirect(`/#claim_token=${claimToken}`);
      } catch (err) {
        app.log.error({ err }, '[viewer-auth] oauth failed');
        return reply.code(502).send('failed to authenticate viewer with Twitch');
      }
    },
  );

  // Dev-only: mint a claim token for a fake viewer without Twitch, so the
  // claim -> control loop is exercisable locally. Gated behind MOCK_CHAT.
  if (config.mockChat) {
    app.get(
      '/auth/viewer/dev',
      (req: FastifyRequest<{ Querystring: { name?: string } }>, reply: FastifyReply) => {
        const name = req.query.name ?? `Guest${Math.floor(Math.random() * 1000)}`;
        const claimToken = mintClaimToken({
          userId: `dev-${name.toLowerCase()}`,
          displayName: name,
        });
        return reply.redirect(`/#claim_token=${claimToken}`);
      },
    );
  }
}
