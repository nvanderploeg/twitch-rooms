/**
 * The authoritative Room.
 *
 * Owns the single in-memory RoomState (channel, seq, avatars) for this Room
 * Server. v1 keeps logic deliberately simple but real: every chatter gets an
 * avatar, claims flip an avatar to controlled, and actions mutate state. The
 * monotonic `seq` lets Viewers order/dedupe the full-snapshot broadcasts.
 */
import type {
  AvatarState,
  ChatMessage,
  RoomConfig,
  RoomState,
  ViewerAction,
} from '@twitch-room/protocol';

import { recordClaim } from './db.js';

/** Default avatar spawn position, in scene units. */
const SPAWN = { x: 0, y: 0 } as const;

export class Room {
  private channel: string;
  private seq = 0;
  /** Avatars keyed by Twitch user id for O(1) lookup; snapshot flattens to array. */
  private readonly avatars = new Map<string, AvatarState>();
  private config: RoomConfig;

  constructor(config: RoomConfig) {
    this.config = config;
    this.channel = config.channel;
  }

  /** Swap in a new RoomConfig (e.g. after the Streamer edits it via the panel). */
  reconfigure(config: RoomConfig): void {
    this.config = config;
    this.channel = config.channel;
    this.seq += 1;
  }

  /** The currently-loaded RoomConfig. */
  getConfig(): RoomConfig {
    return this.config;
  }

  /**
   * Ensure an avatar exists for a chatter and bump the sequence. Called for
   * every ingested chat message so the scene is populated purely from chat.
   */
  applyChat(msg: ChatMessage): void {
    const existing = this.avatars.get(msg.userId);
    if (existing) {
      // Keep display data fresh; chatters can change name/color over time.
      existing.displayName = msg.displayName;
      if (msg.color) {
        existing.color = msg.color;
      }
    } else {
      const avatar: AvatarState = {
        userId: msg.userId,
        displayName: msg.displayName,
        x: SPAWN.x,
        y: SPAWN.y,
        claimed: false,
      };
      if (msg.color) {
        avatar.color = msg.color;
      }
      this.avatars.set(msg.userId, avatar);
    }
    this.seq += 1;
  }

  /**
   * Apply a claimed Viewer's web-side action to their avatar. No-op if the user
   * has no avatar yet (they must have chatted at least once to exist).
   */
  applyAction(userId: string, action: ViewerAction): void {
    const avatar = this.avatars.get(userId);
    if (!avatar) {
      return;
    }
    switch (action.kind) {
      case 'move':
        avatar.x = action.x;
        avatar.y = action.y;
        break;
      case 'emote':
        // TODO: surface emote actions as a transient scene event once the
        // protocol carries per-action broadcast events (v1 only snapshots state).
        break;
      case 'module':
        // TODO: dispatch to the addressed Module's handler once Modules own state.
        break;
    }
    this.seq += 1;
  }

  /**
   * Bind a Twitch user to their avatar (creating a placeholder if they have not
   * chatted yet) and mark it claimed. Persists the claim for reconnect.
   */
  claim(userId: string, displayName: string): void {
    let avatar = this.avatars.get(userId);
    if (!avatar) {
      avatar = {
        userId,
        displayName,
        x: SPAWN.x,
        y: SPAWN.y,
        claimed: true,
      };
      this.avatars.set(userId, avatar);
    } else {
      avatar.claimed = true;
      avatar.displayName = displayName;
    }
    recordClaim(userId, displayName);
    this.seq += 1;
  }

  /** Full authoritative snapshot to broadcast to Viewers. */
  snapshot(): RoomState {
    return {
      channel: this.channel,
      seq: this.seq,
      avatars: [...this.avatars.values()],
    };
  }
}
