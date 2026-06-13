/**
 * Embedded SQLite persistence for the Room Server (ADR-0004).
 *
 * A Room Server is single-tenant (one Room, modest write-concurrency), so we use
 * Node's built-in synchronous SQLite driver (`node:sqlite`) writing to a single
 * host bind-mounted file at `${DATA_DIR}/room.db`. There is no database container.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { RoomConfig } from '@twitch-room/protocol';

import { config } from './config.js';

/** The open database handle for this process. */
let database: DatabaseSync | undefined;

/**
 * Open (creating parent dirs as needed) the SQLite database at
 * `${DATA_DIR}/room.db`. Idempotent: returns the existing handle if already open.
 */
export function openDb(): DatabaseSync {
  if (database) {
    return database;
  }
  mkdirSync(config.dataDir, { recursive: true });
  const path = join(config.dataDir, 'room.db');
  database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL;');
  return database;
}

function db(): DatabaseSync {
  if (!database) {
    throw new Error('[room-server:db] database not open; call openDb() first');
  }
  return database;
}

/**
 * Idempotently create the schema. Safe to run on every boot.
 *
 * - `config`: the single RoomConfig document (singleton row, id always 1).
 * - `claims`: which Twitch user ids have claimed their avatar in this Room.
 */
export function migrate(): void {
  const handle = db();
  handle.exec(`
    CREATE TABLE IF NOT EXISTS config (
      id   INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL
    )
  `);
  handle.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      user_id      TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      claimed_at   INTEGER NOT NULL
    )
  `);
}

/** A sensible default RoomConfig for a freshly-provisioned Room. */
function defaultConfig(): RoomConfig {
  return {
    version: 1,
    channel: config.channel,
    theme: { name: 'default' },
    scene: { name: 'lounge' },
    modules: [
      { type: 'avatars', enabled: true, params: {} },
      { type: 'chatFeed', enabled: true, params: {} },
    ],
  };
}

/**
 * Load the stored RoomConfig, or a sensible default if none has been persisted
 * yet. The default is not written back; the first explicit `saveConfig` persists.
 */
export function loadConfig(): RoomConfig {
  const row = db().prepare('SELECT json FROM config WHERE id = 1').get() as
    | { json: string }
    | undefined;
  if (!row) {
    return defaultConfig();
  }
  // TODO: validate the parsed document against the RoomConfig schema before
  // trusting it (a hand-edited DB or an older schema version could be invalid).
  return JSON.parse(row.json) as RoomConfig;
}

/** Persist the RoomConfig as the singleton row. */
export function saveConfig(cfg: RoomConfig): void {
  db()
    .prepare(
      `INSERT INTO config (id, json) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
    )
    .run(JSON.stringify(cfg));
}

/** Record an avatar claim by a Twitch user. */
export function recordClaim(userId: string, displayName: string): void {
  db()
    .prepare(
      `INSERT INTO claims (user_id, display_name, claimed_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name`,
    )
    .run(userId, displayName, Date.now());
}

/** Whether a given Twitch user has previously claimed their avatar. */
export function hasClaim(userId: string): boolean {
  const row = db().prepare('SELECT 1 FROM claims WHERE user_id = ?').get(userId);
  return row !== undefined;
}
