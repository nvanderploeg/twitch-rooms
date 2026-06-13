import type { ChatMessage } from './chat.js';
import type { ModuleType, RoomConfig, RoomState } from './room.js';

/* ------------------------------------------------------------------ *
 * Viewer (browser) -> Room Server
 * ------------------------------------------------------------------ */

/** Sent by the browser immediately upon opening the wss connection. */
export interface HelloMessage {
  type: 'hello';
  protocolVersion: number;
}

/**
 * Sent when a Viewer logs in with Twitch to claim their avatar. The token is a
 * session credential issued by the Room Server's OAuth flow proving Twitch identity.
 */
export interface ClaimMessage {
  type: 'claim';
  token: string;
}

/** A web-side action taken by a claimed Viewer. */
export interface ActionMessage {
  type: 'action';
  action: ViewerAction;
}

/** The set of actions a claimed Viewer can take in the Room. */
export type ViewerAction =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'emote'; emoteId: string }
  | { kind: 'module'; moduleType: ModuleType; payload: Record<string, unknown> };

/** Any message the browser may send to the Room Server. */
export type ClientMessage = HelloMessage | ClaimMessage | ActionMessage;

/* ------------------------------------------------------------------ *
 * Room Server -> Viewer (browser)
 * ------------------------------------------------------------------ */

/** First server message after a successful hello: config + initial state. */
export interface WelcomeMessage {
  type: 'welcome';
  protocolVersion: number;
  config: RoomConfig;
  state: RoomState;
  /** The avatar userId bound to this connection once claimed, else null. */
  claimedUserId: string | null;
}

/** A room state update (full snapshot in v1; deltas later). */
export interface StateMessage {
  type: 'state';
  state: RoomState;
}

/** A chat message to render in the scene. */
export interface ChatEventMessage {
  type: 'chat';
  message: ChatMessage;
}

/** An error the Room Server reports to the Viewer. */
export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

/** Any message the Room Server may send to the browser. */
export type ServerMessage =
  | WelcomeMessage
  | StateMessage
  | ChatEventMessage
  | ErrorMessage;
