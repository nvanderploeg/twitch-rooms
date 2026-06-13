import type { ChatColor } from './chat.js';

/** The built-in Modules the Engine can run in a Room. v1 ships a curated set. */
export type ModuleType = 'avatars' | 'emoteRain' | 'polls' | 'chatFeed';

/**
 * A built-in Module enabled within a Room, with module-specific parameters.
 * The Engine validates `params` per module type.
 */
export interface ModuleConfig<TParams = Record<string, unknown>> {
  type: ModuleType;
  enabled: boolean;
  params: TParams;
}

/** Visual theme/palette applied by the Engine. */
export interface ThemeConfig {
  /** Named theme the Engine maps to concrete styling, e.g. "neon". */
  name: string;
  /** Background color or asset url. */
  background?: string;
  /** Accent color. */
  accent?: ChatColor;
}

/** Named scene/layout the Room renders in, e.g. "tavern". */
export interface SceneConfig {
  name: string;
  /** Optional background asset url. */
  backgroundUrl?: string;
}

/**
 * The declarative document that defines a Room's looks and functionality.
 * Authored via the Room Server's config panel, persisted in the Room's SQLite,
 * and sent to every Viewer in the `welcome` message.
 */
export interface RoomConfig {
  /** Schema version of this config document. */
  version: number;
  /** Twitch login of the channel this Room belongs to. */
  channel: string;
  theme: ThemeConfig;
  scene: SceneConfig;
  modules: ModuleConfig[];
}

/** One avatar in the Room's authoritative state. */
export interface AvatarState {
  /** Twitch user id of the chatter/Viewer this avatar represents. */
  userId: string;
  displayName: string;
  color?: ChatColor;
  /** Normalized scene position in [0, 1]; the client scales to its canvas. */
  x: number;
  y: number;
  /** True while a logged-in Viewer actively controls this avatar. */
  claimed: boolean;
}

/**
 * Authoritative snapshot of a Room's live state, owned by the Room Server and
 * broadcast to Viewers. v1 sends full snapshots; deltas are a later optimization.
 */
export interface RoomState {
  channel: string;
  /** Monotonic sequence number; Viewers use it to order/dedupe updates. */
  seq: number;
  avatars: AvatarState[];
}
