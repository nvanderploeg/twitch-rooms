/**
 * @twitch-room/protocol
 *
 * Shared TypeScript types for messages exchanged between the web client (Viewer),
 * the Room Server, and the Hub. This is the single source of truth for the wire
 * contract across all three deployable units.
 *
 * Placeholder only for now — the real message schema depends on decisions that
 * are still open (see the TODOs below).
 */

/**
 * Bumped whenever the wire contract changes in an incompatible way. Endpoints can
 * compare this on connect to refuse mismatched peers.
 */
export const PROTOCOL_VERSION = 0 as const;

// TODO(decision pending): realtime transport (WebRTC vs WebSocket vs other) is
// undecided. Once chosen, the envelope/framing for these messages lives here.

/**
 * Placeholder base type for every protocol message. Real message variants
 * (a discriminated union keyed on `type`) will replace/extend this.
 */
export interface ProtocolMessage {
  /** Discriminator for the message variant. */
  type: string;
}

/** Placeholder export proving the workspace link resolves end to end. */
export interface Placeholder extends ProtocolMessage {
  type: 'placeholder';
}
