/**
 * Twitch EventSub WebSocket ingest.
 *
 * The Room Server reads the channel's chat through Twitch EventSub over a
 * WebSocket. On `session_welcome` it must create a `channel.chat.message`
 * subscription via Helix using the Streamer's app/user token and the issued
 * `session_id`; thereafter `notification` frames carry chat messages, which we
 * normalize into the protocol's `ChatMessage` and hand to `onChat`.
 *
 * Credential-dependent parts (token acquisition, the Helix subscription POST)
 * are wired but marked `// TODO:` since they require the Streamer's OAuth.
 */
import { WebSocket } from 'ws';

import type { ChatMessage } from '@twitch-room/protocol';

import { config } from '../config.js';

/** Callback invoked for every normalized chat message. */
export type OnChat = (msg: ChatMessage) => void;

/** A source of chat messages feeding the Room (real Twitch or a mock). */
export interface ChatSource {
  start(): void | Promise<void>;
  stop(): void;
}

const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const HELIX_SUBSCRIPTIONS_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';

/* ------------------------------------------------------------------ *
 * Minimal shapes of the EventSub frames we consume.
 * ------------------------------------------------------------------ */

interface EventSubMetadata {
  message_id: string;
  message_type:
    | 'session_welcome'
    | 'session_keepalive'
    | 'session_reconnect'
    | 'notification'
    | 'revocation';
  message_timestamp: string;
  subscription_type?: string;
}

interface EventSubFrame {
  metadata: EventSubMetadata;
  payload: {
    session?: { id: string; reconnect_url?: string | null };
    event?: ChatMessageEvent;
  };
}

/** The `channel.chat.message` event payload (subset we map). */
interface ChatMessageEvent {
  message_id: string;
  broadcaster_user_id: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  color?: string;
  message: {
    text: string;
    fragments: Array<{
      type: string;
      text: string;
      emote?: { id: string } | null;
    }>;
  };
  badges: Array<{ set_id: string; id: string }>;
}

/**
 * EventSub-backed chat source. Maintains the WebSocket lifecycle and translates
 * `channel.chat.message` notifications into `ChatMessage`.
 */
export class EventSubChatSource implements ChatSource {
  private socket: WebSocket | undefined;
  private sessionId: string | undefined;
  private stopped = false;

  constructor(private readonly onChat: OnChat) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = undefined;
  }

  private connect(url: string = EVENTSUB_WS_URL): void {
    const ws = new WebSocket(url);
    this.socket = ws;

    ws.on('open', () => {
      console.log('[eventsub] websocket connected');
    });

    ws.on('message', (data) => {
      let frame: EventSubFrame;
      try {
        frame = JSON.parse(data.toString()) as EventSubFrame;
      } catch {
        console.warn('[eventsub] dropped non-JSON frame');
        return;
      }
      this.handleFrame(frame);
    });

    ws.on('error', (err) => {
      console.error('[eventsub] socket error:', err.message);
    });

    ws.on('close', () => {
      if (this.stopped) {
        return;
      }
      // TODO: honor session_reconnect's reconnect_url and use proper backoff.
      console.warn('[eventsub] socket closed; reconnecting in 5s');
      setTimeout(() => this.connect(), 5000);
    });
  }

  private handleFrame(frame: EventSubFrame): void {
    switch (frame.metadata.message_type) {
      case 'session_welcome': {
        const id = frame.payload.session?.id;
        if (!id) {
          console.error('[eventsub] session_welcome missing session id');
          return;
        }
        this.sessionId = id;
        console.log('[eventsub] session established:', id);
        void this.createSubscription(id);
        break;
      }
      case 'session_keepalive':
        // Connection is healthy; nothing to do. Absence over the keepalive
        // window is what would signal a dead connection.
        break;
      case 'session_reconnect':
        // TODO: reconnect to payload.session.reconnect_url without dropping subs.
        console.warn('[eventsub] reconnect requested by Twitch');
        break;
      case 'notification':
        if (frame.metadata.subscription_type === 'channel.chat.message' && frame.payload.event) {
          this.onChat(toChatMessage(frame.payload.event));
        }
        break;
      case 'revocation':
        console.warn('[eventsub] subscription revoked:', frame.metadata.subscription_type);
        break;
    }
  }

  /**
   * Create the `channel.chat.message` subscription bound to this WebSocket
   * session. Requires the Streamer's user access token (with `user:read:chat`)
   * and the broadcaster + bot user ids resolved from their Twitch identity.
   */
  private async createSubscription(sessionId: string): Promise<void> {
    // TODO: acquire a valid Twitch user access token from the OAuth/token store
    // (see twitch/oauth.ts) instead of a placeholder. Refresh if expired.
    const userToken = '';
    // TODO: resolve broadcaster_user_id and user_id (the reader) for `config.channel`
    // via Helix /users; these are required by channel.chat.message conditions.
    const broadcasterUserId = '';
    const readerUserId = '';

    if (!userToken || !broadcasterUserId || !readerUserId) {
      console.warn(
        '[eventsub] missing Twitch credentials/ids; subscription not created (configure OAuth)',
      );
      return;
    }

    try {
      const res = await fetch(HELIX_SUBSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Client-Id': config.twitchClientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'channel.chat.message',
          version: '1',
          condition: {
            broadcaster_user_id: broadcasterUserId,
            user_id: readerUserId,
          },
          transport: { method: 'websocket', session_id: sessionId },
        }),
      });
      if (!res.ok) {
        console.error('[eventsub] subscription POST failed:', res.status, await res.text());
        return;
      }
      console.log('[eventsub] channel.chat.message subscription created');
    } catch (err) {
      console.error('[eventsub] subscription POST error:', err);
    }
  }
}

/** Normalize a Twitch `channel.chat.message` event into the protocol shape. */
function toChatMessage(ev: ChatMessageEvent): ChatMessage {
  let cursor = 0;
  const emotes = ev.message.fragments.flatMap((f) => {
    const start = cursor;
    cursor += f.text.length;
    if (f.type === 'emote' && f.emote) {
      return [{ id: f.emote.id, name: f.text, start, end: cursor - 1 }];
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
  if (ev.color && ev.color.startsWith('#')) {
    msg.color = ev.color as ChatMessage['color'];
  }
  return msg;
}

/* ------------------------------------------------------------------ *
 * Dev-only mock source (gated behind MOCK_CHAT=1).
 * ------------------------------------------------------------------ */

const MOCK_CHATTERS = [
  { userId: 'mock-1', username: 'plumberpat', displayName: 'PlumberPat', color: '#FF7F50' },
  { userId: 'mock-2', username: 'galaxygina', displayName: 'GalaxyGina', color: '#7FFFD4' },
  { userId: 'mock-3', username: 'novanorm', displayName: 'NovaNorm', color: '#C77DFF' },
] as const;

const MOCK_LINES = ['hello room!', 'PogChamp', 'gg', 'first time here', 'love this stream <3'];

/**
 * Emits a fake ChatMessage every few seconds so the chat -> avatar -> broadcast
 * pipeline is exercisable without Twitch. Dev only; gated by MOCK_CHAT=1.
 */
export class MockChatSource implements ChatSource {
  private timer: NodeJS.Timeout | undefined;
  private n = 0;

  constructor(
    private readonly onChat: OnChat,
    private readonly intervalMs = 3000,
  ) {}

  start(): void {
    console.log('[mock-chat] emitting fake chat every', this.intervalMs, 'ms');
    this.timer = setInterval(() => this.emit(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private emit(): void {
    const chatter = MOCK_CHATTERS[this.n % MOCK_CHATTERS.length]!;
    const text = MOCK_LINES[this.n % MOCK_LINES.length]!;
    this.n += 1;
    this.onChat({
      id: `mock-${this.n}`,
      channelId: 'mock-channel',
      userId: chatter.userId,
      username: chatter.username,
      displayName: chatter.displayName,
      color: chatter.color,
      text,
      emotes: [],
      badges: [],
      timestamp: Date.now(),
    });
  }
}
