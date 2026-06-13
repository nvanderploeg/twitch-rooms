/**
 * Twitch OAuth routes.
 *
 *   GET /auth/twitch/login    -> redirect the Streamer to Twitch's authorize page
 *   GET /auth/twitch/callback -> exchange the code, verify the login, issue a
 *                                registration token, and show it to the Streamer
 *
 * The issued token is the value the Streamer pastes into their Room Server
 * config; the Room Server uses it as a Bearer token on the directory API.
 */
import { randomBytes } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';

import { buildAuthorizeUrl, exchangeCode } from '../twitch.js';
import { issueRegistrationToken } from '../tokens.js';

const STATE_COOKIE = 'hub_oauth_state';

interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/auth/twitch/login', async (_request, reply) => {
    const state = randomBytes(16).toString('hex');
    reply.setCookie(STATE_COOKIE, state, {
      path: '/auth/twitch',
      httpOnly: true,
      sameSite: 'lax',
      // TODO: set `secure: true` once the Hub is served over HTTPS in production.
      maxAge: 600,
    });
    return reply.redirect(buildAuthorizeUrl(state));
  });

  app.get<{ Querystring: CallbackQuery }>('/auth/twitch/callback', async (request, reply) => {
    const { code, state, error, error_description } = request.query;

    if (error) {
      reply.code(400).type('text/html');
      return `<h1>Twitch sign-in failed</h1><p>${escapeHtml(error_description ?? error)}</p>`;
    }

    const expectedState = request.cookies[STATE_COOKIE];
    if (!state || !expectedState || state !== expectedState) {
      reply.code(400).type('text/html');
      return '<h1>Invalid OAuth state</h1><p>Please start sign-in again.</p>';
    }
    reply.clearCookie(STATE_COOKIE, { path: '/auth/twitch' });

    if (!code) {
      reply.code(400).type('text/html');
      return '<h1>Missing authorization code</h1>';
    }

    let login: string;
    try {
      // TODO: real Twitch credentials required for this to succeed end-to-end.
      ({ login } = await exchangeCode(code));
    } catch (err) {
      request.log.error({ err }, 'twitch code exchange failed');
      reply.code(502).type('text/html');
      return '<h1>Could not verify your Twitch account</h1><p>Please try again.</p>';
    }

    const token = await issueRegistrationToken(login);

    reply.type('text/html');
    return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Room registration token</title></head>
  <body style="font-family: system-ui; max-width: 40rem; margin: 3rem auto;">
    <h1>You're verified as <code>${escapeHtml(login)}</code></h1>
    <p>Paste this registration token into your Room Server config (it authorizes
       your Room Server to register with the Hub):</p>
    <pre style="padding: 1rem; background: #111; color: #0f0; overflow-x: auto;">${escapeHtml(token)}</pre>
    <p><strong>Keep it secret.</strong> Anyone with this token can register a Room
       as <code>${escapeHtml(login)}</code>.</p>
  </body>
</html>`;
  });
};
