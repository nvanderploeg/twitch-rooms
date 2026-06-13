/**
 * Directory repository: typed read/write access to the `rooms` table.
 *
 * These functions are the only place that knows the row<->protocol mapping. They
 * carry no live Room traffic; the Hub stays a thin directory (ADR-0001).
 */
import type { RegisterRequest, RoomDirectoryEntry, RoomPresence } from '@twitch-room/protocol';

import { pool } from './db.js';

/** Shape of a `rooms` row as returned by pg. */
interface RoomRow {
  channel: string;
  public_endpoint: string;
  protocol_version: number;
  presence: string;
  last_seen: string; // BIGINT comes back as a string from pg
}

function rowToEntry(row: RoomRow): RoomDirectoryEntry {
  return {
    channel: row.channel,
    publicEndpoint: row.public_endpoint,
    presence: row.presence as RoomPresence,
    protocolVersion: row.protocol_version,
    lastSeen: Number(row.last_seen),
  };
}

/**
 * Insert or refresh a Room's directory entry, marking it online with a fresh
 * last_seen. Called on register (and effectively a re-register on reconnect).
 */
export async function upsertRegistration(req: RegisterRequest): Promise<void> {
  const now = Date.now();
  await pool.query(
    `
    INSERT INTO rooms (channel, public_endpoint, protocol_version, presence, last_seen)
    VALUES ($1, $2, $3, 'online', $4)
    ON CONFLICT (channel) DO UPDATE SET
      public_endpoint  = EXCLUDED.public_endpoint,
      protocol_version = EXCLUDED.protocol_version,
      presence         = 'online',
      last_seen        = EXCLUDED.last_seen
    `,
    [req.channel, req.publicEndpoint, req.protocolVersion, now],
  );
}

/**
 * Refresh a Room's heartbeat: bump last_seen and keep it online. No-op if the
 * channel is unknown (a heartbeat before register is ignored).
 */
export async function touchHeartbeat(channel: string): Promise<void> {
  await pool.query(
    `UPDATE rooms SET presence = 'online', last_seen = $2 WHERE channel = $1`,
    [channel, Date.now()],
  );
}

/** Fetch a single Room's directory entry, or null if unknown. */
export async function getRoom(channel: string): Promise<RoomDirectoryEntry | null> {
  const result = await pool.query<RoomRow>(
    `SELECT channel, public_endpoint, protocol_version, presence, last_seen
       FROM rooms WHERE channel = $1`,
    [channel],
  );
  const row = result.rows[0];
  return row ? rowToEntry(row) : null;
}

/** List every Room currently marked online. */
export async function listOnline(): Promise<RoomDirectoryEntry[]> {
  const result = await pool.query<RoomRow>(
    `SELECT channel, public_endpoint, protocol_version, presence, last_seen
       FROM rooms WHERE presence = 'online' ORDER BY channel`,
  );
  return result.rows.map(rowToEntry);
}

/**
 * Flip any 'online' Room whose last heartbeat is older than `timeoutMs` to
 * 'offline'. Returns the number of Rooms swept.
 */
export async function sweepOffline(timeoutMs: number): Promise<number> {
  const cutoff = Date.now() - timeoutMs;
  const result = await pool.query(
    `UPDATE rooms SET presence = 'offline'
       WHERE presence = 'online' AND last_seen < $1`,
    [cutoff],
  );
  return result.rowCount ?? 0;
}
