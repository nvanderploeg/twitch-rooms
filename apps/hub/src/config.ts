/**
 * Environment configuration for the Hub.
 *
 * The Hub is operator-run; every value here comes from the deploy environment
 * (see .env.example). Validation is fail-fast: a missing required var throws on
 * boot rather than producing a half-configured server.
 */

export interface Config {
  /** Port the Fastify server listens on. */
  port: number;
  /** Postgres connection string for the directory database. */
  databaseUrl: string;
  /** Public base URL the Hub is reachable at (used to build the OAuth redirect target and links). */
  hubPublicUrl: string;
  /** Twitch application client id (OAuth). */
  twitchClientId: string;
  /** Twitch application client secret (OAuth). */
  twitchClientSecret: string;
  /** Registered Twitch OAuth redirect URI (must match the Twitch app config). */
  twitchRedirectUri: string;
  /** Interval (ms) a Room Server must heartbeat within to stay online. */
  heartbeatIntervalMs: number;
  /** A Room with no heartbeat for this long (ms) is swept to 'offline'. */
  presenceTimeoutMs: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`[hub:config] missing required environment variable: ${name}`);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`[hub:config] invalid integer for ${name}: ${raw}`);
  }
  return parsed;
}

/**
 * Build and validate the config from process.env. Throws on the first missing
 * or invalid required variable so boot fails loudly.
 */
export function loadConfig(): Config {
  return {
    port: intEnv('PORT', 8080),
    databaseUrl: requireEnv('DATABASE_URL'),
    hubPublicUrl: requireEnv('HUB_PUBLIC_URL'),
    twitchClientId: requireEnv('TWITCH_CLIENT_ID'),
    twitchClientSecret: requireEnv('TWITCH_CLIENT_SECRET'),
    twitchRedirectUri: requireEnv('TWITCH_REDIRECT_URI'),
    heartbeatIntervalMs: intEnv('HEARTBEAT_INTERVAL_MS', 30000),
    presenceTimeoutMs: intEnv('PRESENCE_TIMEOUT_MS', 90000),
  };
}

/** The validated, typed config for this process. */
export const config: Config = loadConfig();
