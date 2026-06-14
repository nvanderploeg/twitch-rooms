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
import { parseChatMessage, type ChatMessageEvent } from './chat-parse.js';

// Re-export the pure parser + event shapes (defined in chat-parse.ts so they are
// testable without this module's config side effects).
export { parseChatMessage } from './chat-parse.js';
export type { ChatMessageEvent, ChatMessageFragment } from './chat-parse.js';

/** Callback invoked for every normalized chat message. */
export type OnChat = (msg: ChatMessage) => void;

/**
 * Resolves a currently-valid Twitch user access token + the broadcaster user id,
 * or null when the Streamer has not authenticated yet. Injected so the EventSub
 * source stays decoupled from the OAuth/token store (see twitch/oauth.ts).
 */
export type TokenAccessor = () => Promise<{ accessToken: string; userId: string } | null>;

/** A source of chat messages feeding the Room (real Twitch or a mock). */
export interface ChatSource {
  start(): void | Promise<void>;
  stop(): void;
}

const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const HELIX_SUBSCRIPTIONS_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';

/** How often to retry acquiring a token before the Streamer has authenticated. */
const TOKEN_RETRY_MS = 15_000;
/** Reconnect backoff bounds after an unexpected socket close. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

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

/**
 * EventSub-backed chat source. Maintains the WebSocket lifecycle and translates
 * `channel.chat.message` notifications into `ChatMessage`.
 */
export class EventSubChatSource implements ChatSource {
  private socket: WebSocket | undefined;
  private sessionId: string | undefined;
  private stopped = false;
  /** Token + broadcaster id for the current session, captured on connect. */
  private auth: { accessToken: string; userId: string } | undefined;
  /** Pending timer for token retry / reconnect backoff. */
  private timer: NodeJS.Timeout | undefined;
  /** Current reconnect backoff (doubles up to RECONNECT_MAX_MS). */
  private backoffMs = RECONNECT_MIN_MS;

  constructor(
    private readonly onChat: OnChat,
    private readonly getToken: TokenAccessor,
  ) {}

  start(): void {
    this.stopped = false;
    void this.connectWithToken();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.socket?.close();
    this.socket = undefined;
  }

  /**
   * Acquire a token, then connect. If no token is available yet (the Streamer
   * has not authenticated), log a clear message and retry periodically rather
   * than crashing.
   */
  private async connectWithToken(): Promise<void> {
    if (this.stopped) {
      return;
    }
    let auth: { accessToken: string; userId: string } | null;
    try {
      auth = await this.getToken();
    } catch (err) {
      console.error('[eventsub] token lookup failed:', err instanceof Error ? err.message : err);
      auth = null;
    }
    if (!auth) {
      console.warn(
        `[eventsub] no Twitch token yet — the streamer must visit /auth/twitch/login; ` +
          `retrying in ${TOKEN_RETRY_MS / 1000}s`,
      );
      this.scheduleRetry(TOKEN_RETRY_MS);
      return;
    }
    this.auth = auth;
    this.connect();
  }

  private scheduleRetry(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.connectWithToken();
    }, delayMs);
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
      // Re-acquire a token (it may have expired) and reconnect with backoff.
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_MS);
      console.warn(`[eventsub] socket closed; reconnecting in ${delay}ms`);
      this.scheduleRetry(delay);
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
        // A successful welcome means the connection is healthy; reset backoff.
        this.backoffMs = RECONNECT_MIN_MS;
        console.log('[eventsub] session established:', id);
        void this.createSubscription(id);
        break;
      }
      case 'session_keepalive':
        // Connection is healthy; nothing to do. Absence over the keepalive
        // window is what would signal a dead connection.
        break;
      case 'session_reconnect': {
        // Twitch is migrating us to a new edge; reconnect to the provided URL
        // (the new socket re-issues session_welcome, after which we re-subscribe).
        const reconnectUrl = frame.payload.session?.reconnect_url;
        console.warn('[eventsub] reconnect requested by Twitch');
        if (reconnectUrl) {
          // Open the new socket before closing the old one is ideal, but a simple
          // swap is acceptable here: close the old, connect to the new URL.
          const old = this.socket;
          this.socket = undefined;
          this.connect(reconnectUrl);
          old?.close();
        }
        break;
      }
      case 'notification':
        if (frame.metadata.subscription_type === 'channel.chat.message' && frame.payload.event) {
          this.onChat(parseChatMessage(frame.payload.event));
        }
        break;
      case 'revocation':
        console.warn('[eventsub] subscription revoked:', frame.metadata.subscription_type);
        break;
    }
  }

  /**
   * Create the `channel.chat.message` subscription bound to this WebSocket
   * session, using the Streamer's user access token and broadcaster user id.
   */
  private async createSubscription(sessionId: string): Promise<void> {
    const auth = this.auth;
    if (!auth) {
      console.warn('[eventsub] no token captured for session; cannot subscribe');
      return;
    }
    try {
      const res = await fetch(HELIX_SUBSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Client-Id': config.twitchClientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'channel.chat.message',
          version: '1',
          condition: {
            broadcaster_user_id: auth.userId,
            user_id: auth.userId,
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
