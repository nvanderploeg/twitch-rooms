/**
 * Environment configuration for the Room Server.
 *
 * The Room Server is Streamer-run; every value here comes from the deploy
 * environment (see .env.example). Validation is fail-fast for the few values
 * that have no sane default — a missing required var throws on boot rather than
 * producing a half-configured server.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface Config {
  /** Port the Fastify server listens on. */
  port: number;
  /** Twitch login of the channel this Room belongs to (the directory key). */
  channel: string;
  /** Public wss:// endpoint Viewers connect to directly (registered with the Hub). */
  publicEndpoint: string;
  /** Base URL of the Hub directory API. */
  hubUrl: string;
  /** Bearer token proving this Streamer may register `channel` with the Hub. */
  registrationToken: string;
  /** Twitch application client id (OAuth + Helix). */
  twitchClientId: string;
  /** Twitch application client secret (OAuth + Helix). */
  twitchClientSecret: string;
  /** Registered Twitch OAuth redirect URI (must match the Twitch app config). */
  twitchRedirectUri: string;
  /** Directory for persistent data; the SQLite file lives at `${dataDir}/room.db`. */
  dataDir: string;
  /** Directory of the built web client served at the Public Endpoint origin. */
  webDist: string;
  /** When set (MOCK_CHAT=1), use the in-process fake chat source instead of Twitch. */
  mockChat: boolean;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`[room-server:config] missing required environment variable: ${name}`);
  }
  return value;
}

function optEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`[room-server:config] invalid integer for ${name}: ${raw}`);
  }
  return parsed;
}

function boolEnv(name: string): boolean {
  const raw = process.env[name];
  return raw === '1' || raw?.toLowerCase() === 'true';
}

/**
 * Build and validate the config from process.env. Throws on the first missing
 * or invalid required variable so boot fails loudly.
 *
 * TWITCH_* are required for the real chat path, but are unused under MOCK_CHAT
 * (OAuth is stubbed and EventSub is replaced by the in-process mock source), so
 * they are optional in mock mode — a local pipeline test needs no Twitch app.
 */
export function loadConfig(): Config {
  // Default web dist: the sibling `apps/web/dist`, resolved from the built
  // location of this file (apps/room-server/dist/config.js).
  const defaultWebDist = resolve(HERE, '../../web/dist');
  const mockChat = boolEnv('MOCK_CHAT');

  // In mock mode the Twitch credentials are unused; don't force a throwaway app.
  const requireTwitch = (name: string): string =>
    mockChat ? optEnv(name, '') : requireEnv(name);

  return {
    port: intEnv('PORT', 8080),
    channel: requireEnv('CHANNEL').toLowerCase(),
    publicEndpoint: requireEnv('PUBLIC_ENDPOINT'),
    hubUrl: requireEnv('HUB_URL').replace(/\/+$/, ''),
    registrationToken: requireEnv('REGISTRATION_TOKEN'),
    twitchClientId: requireTwitch('TWITCH_CLIENT_ID'),
    twitchClientSecret: requireTwitch('TWITCH_CLIENT_SECRET'),
    twitchRedirectUri: requireTwitch('TWITCH_REDIRECT_URI'),
    dataDir: optEnv('DATA_DIR', './data'),
    webDist: optEnv('WEB_DIST', defaultWebDist),
    mockChat,
  };
}

/** The validated, typed config for this process. */
export const config: Config = loadConfig();
