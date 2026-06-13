import { PROTOCOL_VERSION } from '@twitch-room/protocol';
import type { ClientMessage, ServerMessage } from '@twitch-room/protocol';

/** Lifecycle status of the underlying WebSocket. */
export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/** Callback invoked for each parsed server message. */
export type MessageListener = (msg: ServerMessage) => void;

/** Callback invoked whenever the connection status changes. */
export type StatusListener = (status: ConnectionStatus) => void;

export interface ConnectionOptions {
  /** Full wss URL to connect to. Defaults to derived `wss://<host>/ws`. */
  url?: string;
  /** Base reconnect delay in ms. Backoff grows up to `maxBackoffMs`. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * Derive the Room Server's WebSocket endpoint. Prefers an explicit dev override
 * (`VITE_ROOM_WS_URL`), otherwise uses the same origin the client was served from.
 */
export function deriveWsUrl(): string {
  const override = import.meta.env.VITE_ROOM_WS_URL;
  if (override) {
    return override;
  }
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/ws`;
}

/**
 * Typed WebSocket client for the Viewer <-> Room Server link. Sends a `hello`
 * on open, parses incoming JSON as `ServerMessage`, dispatches to listeners,
 * and reconnects with exponential backoff.
 */
export class RoomConnection {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  private status: ConnectionStatus = 'closed';
  private backoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByCaller = false;

  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(options: ConnectionOptions = {}) {
    this.url = options.url ?? deriveWsUrl();
    this.baseBackoffMs = options.baseBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 10_000;
    this.backoffMs = this.baseBackoffMs;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Subscribe to server messages. Returns an unsubscribe fn. */
  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  /** Subscribe to status changes. Returns an unsubscribe fn. */
  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Open the connection (idempotent if already connecting/open). */
  connect(): void {
    if (this.ws && (this.status === 'connecting' || this.status === 'open')) {
      return;
    }
    this.closedByCaller = false;
    this.setStatus('connecting');

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.backoffMs = this.baseBackoffMs;
      this.setStatus('open');
      this.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION });
    });

    ws.addEventListener('message', (event) => {
      this.handleRawMessage(event.data);
    });

    ws.addEventListener('close', () => {
      this.ws = null;
      this.setStatus('closed');
      if (!this.closedByCaller) {
        this.scheduleReconnect();
      }
    });

    ws.addEventListener('error', () => {
      // The browser fires `close` after `error`; reconnection is handled there.
      // TODO: surface transport errors to the UI for diagnostics.
    });
  }

  /** Send a client message if the socket is open. */
  send(msg: ClientMessage): void {
    if (this.ws && this.status === 'open') {
      this.ws.send(JSON.stringify(msg));
    }
    // TODO: queue messages sent while not open and flush on reconnect.
  }

  /** Permanently close the connection and stop reconnecting. */
  close(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('closed');
  }

  private handleRawMessage(data: unknown): void {
    if (typeof data !== 'string') {
      // TODO: support binary frames if the protocol adopts them.
      return;
    }
    let parsed: ServerMessage;
    try {
      parsed = JSON.parse(data) as ServerMessage;
    } catch {
      // TODO: report malformed frames.
      return;
    }
    for (const listener of this.messageListeners) {
      listener(parsed);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}
