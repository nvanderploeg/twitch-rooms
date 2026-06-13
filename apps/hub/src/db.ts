/**
 * Postgres connection pool and schema migration for the Hub directory.
 *
 * The Hub's storage is small and durable: which Rooms exist, their presence and
 * Public Endpoint, plus the registration tokens issued to Streamers. No live
 * Room traffic ever touches this database.
 */
import { Pool } from 'pg';

import { config } from './config.js';

/** Shared connection pool, built from DATABASE_URL. */
export const pool = new Pool({ connectionString: config.databaseUrl });

/**
 * Idempotently create the directory schema. Safe to run on every boot.
 */
export async function migrate(): Promise<void> {
  // rooms: one row per Twitch channel (the directory key, see ADR-0002).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      channel          TEXT PRIMARY KEY,
      public_endpoint  TEXT NOT NULL,
      protocol_version INT  NOT NULL,
      presence         TEXT NOT NULL,
      last_seen        BIGINT NOT NULL
    )
  `);

  // room_tokens: Bearer tokens proving a Streamer may register a given channel.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_tokens (
      token      TEXT PRIMARY KEY,
      channel    TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
}
