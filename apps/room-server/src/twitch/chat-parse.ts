/**
 * Pure Twitch `channel.chat.message` -> protocol `ChatMessage` mapping.
 *
 * Deliberately free of any config/network/socket imports so it can be unit-tested
 * in isolation (importing the EventSub client would pull in config.ts, whose env
 * validation runs at module load).
 */
import type { ChatColor, ChatMessage } from '@twitch-room/protocol';

/** A single fragment of the message body (text/emote/cheermote/mention). */
export interface ChatMessageFragment {
  type: 'text' | 'emote' | 'cheermote' | 'mention' | string;
  text: string;
  emote?: { id: string } | null;
}

/** The `channel.chat.message` event payload (subset we map). */
export interface ChatMessageEvent {
  message_id: string;
  broadcaster_user_id: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  /** May be '' when the chatter has not set a name color. */
  color?: string;
  message: {
    text: string;
    fragments: ChatMessageFragment[];
  };
  badges: Array<{ set_id: string; id: string; info?: string }>;
}

/**
 * Normalize a Twitch `channel.chat.message` event into the protocol `ChatMessage`.
 * Emote offsets are computed by walking the message fragments and tracking a
 * running character offset; an emote fragment spans `[offset, offset + len - 1]`.
 */
export function parseChatMessage(ev: ChatMessageEvent): ChatMessage {
  let cursor = 0;
  const emotes = ev.message.fragments.flatMap((f) => {
    const start = cursor;
    cursor += f.text.length;
    if (f.type === 'emote' && f.emote) {
      return [{ id: f.emote.id, name: f.text, start, end: start + f.text.length - 1 }];
    }
    return [];
  });

  const msg: ChatMessage = {
    id: ev.message_id,
    channelId: ev.broadcaster_user_id,
    userId: ev.chatter_user_id,
    username: ev.chatter_user_login,
    displayName: ev.chatter_user_name,
    text: ev.message.text,
    emotes,
    badges: ev.badges.map((b) => ({ setId: b.set_id, id: b.id })),
    timestamp: Date.now(),
  };
  // color may be '' when unset; only assign a non-empty value (typed as ChatColor).
  if (ev.color) {
    msg.color = ev.color as ChatColor;
  }
  return msg;
}
