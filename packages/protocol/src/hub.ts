/**
 * Hub directory API types.
 *
 * Auth: a Room Server authorizes these calls with a Bearer token proving Twitch
 * channel ownership (see ADR-0002). The token travels in the Authorization
 * header, not in these payloads.
 */

/** Room presence as tracked by the Hub's heartbeat. */
export type RoomPresence = 'online' | 'offline';

/** Sent by a Room Server to register or refresh its directory entry. */
export interface RegisterRequest {
  /** Verified Twitch login this Room belongs to. */
  channel: string;
  /** Public wss:// endpoint Viewers connect to directly. */
  publicEndpoint: string;
  /** Protocol version the Room Server speaks. */
  protocolVersion: number;
}

/** Hub's response to a successful registration. */
export interface RegisterResponse {
  ok: true;
  /** Interval (ms) within which the Room Server must heartbeat; miss => offline. */
  heartbeatIntervalMs: number;
}

/** Sent periodically by a Room Server to keep its Room marked online. */
export interface HeartbeatRequest {
  channel: string;
}

/** A Room's public directory entry as the Hub knows it. */
export interface RoomDirectoryEntry {
  channel: string;
  publicEndpoint: string;
  presence: RoomPresence;
  protocolVersion: number;
  /** Last heartbeat time, epoch milliseconds. */
  lastSeen: number;
}
