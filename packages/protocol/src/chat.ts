/** Hex color string for a chat name, e.g. "#FF7F50". */
export type ChatColor = `#${string}`;

/** A single emote occurrence within a chat message's text. */
export interface ChatEmote {
  /** Twitch emote id (used to build the CDN url). */
  id: string;
  /** Emote code, e.g. "Kappa". */
  name: string;
  /** Start offset within the message text (UTF-16 code unit index). */
  start: number;
  /** End offset (inclusive) within the message text. */
  end: number;
}

/** A chat badge the chatter wears, e.g. subscriber/moderator/broadcaster. */
export interface ChatBadge {
  /** Badge set, e.g. "subscriber", "moderator", "broadcaster". */
  setId: string;
  /** Version id within the set. */
  id: string;
}

/**
 * A normalized chat message, derived by the Room Server from a Twitch EventSub
 * `channel.chat.message` event and broadcast to Viewers to drive the scene.
 */
export interface ChatMessage {
  /** Twitch message id. */
  id: string;
  /** Broadcaster (channel) Twitch user id. */
  channelId: string;
  /** Chatter Twitch user id. */
  userId: string;
  /** Chatter login (lowercase). */
  username: string;
  /** Chatter display name. */
  displayName: string;
  /** Chatter name color, if they set one. */
  color?: ChatColor;
  /** Full message text. */
  text: string;
  /** Parsed emote occurrences within `text`. */
  emotes: ChatEmote[];
  /** Badges worn by the chatter. */
  badges: ChatBadge[];
  /** Server receive time, epoch milliseconds. */
  timestamp: number;
}
