/**
 * Registration tokens.
 *
 * After a Streamer proves channel ownership via Twitch OAuth, the Hub issues a
 * random registration token bound to that channel. The Streamer puts the token
 * in their Room Server config; the Room Server then presents it as a Bearer
 * token when registering/heartbeating (see ADR-0002, protocol/hub.ts).
 */
import { randomBytes } from 'node:crypto';

import { pool } from './db.js';

/**
 * Issue and persist a fresh registration token for `channel`. Returns the raw
 * token string to show the Streamer once.
 */
export async function issueRegistrationToken(channel: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO room_tokens (token, channel, created_at) VALUES ($1, $2, $3)`,
    [token, channel, Date.now()],
  );
  return token;
}

/**
 * Resolve a registration token to its channel, or null if the token is unknown.
 */
export async function verifyRegistrationToken(token: string): Promise<string | null> {
  const result = await pool.query<{ channel: string }>(
    `SELECT channel FROM room_tokens WHERE token = $1`,
    [token],
  );
  const row = result.rows[0];
  return row ? row.channel : null;
}
