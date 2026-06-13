/**
 * @twitch-room/protocol
 *
 * Single source of truth for the wire contract shared by the web client (Viewer),
 * the Room Server, and the Hub. Three links are modelled here:
 *   - Viewer  <-> Room Server : ClientMessage / ServerMessage (over wss)
 *   - Room Server <-> Hub     : RegisterRequest / HeartbeatRequest (directory API)
 *   - Room Config & state     : RoomConfig / RoomState / ChatMessage
 */

/** Bumped on any incompatible wire-contract change; peers compare it on connect. */
export const PROTOCOL_VERSION = 1 as const;

export type * from './chat.js';
export type * from './room.js';
export type * from './messages.js';
export type * from './hub.js';
