/**
 * Viewer <-> Room Server WebSocket link (`/ws`).
 *
 * Viewers connect directly to the Room Server's Public Endpoint. The handshake:
 * the browser sends `hello` (with its protocol version), the server replies with
 * `welcome` (config + current snapshot). Thereafter Viewers may `claim` their
 * avatar or send `action`s; the server broadcasts full-state snapshots and chat
 * events to all connected sockets.
 */
import type { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';

import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from '@twitch-room/protocol';

import type { Room } from '../room.js';

/** Per-connection state we track alongside the raw socket. */
interface Connection {
  socket: WebSocket;
  /** Set once the browser has sent a valid `hello`. */
  greeted: boolean;
  /** The Twitch user id bound to this connection once claimed, else null. */
  claimedUserId: string | null;
}

/**
 * Owns the set of live Viewer sockets and the broadcast fan-out. One instance
 * per Room Server, shared by the ws route handler and the chat pipeline.
 */
export class WsHub {
  private readonly connections = new Set<Connection>();

  constructor(private readonly room: Room) {}

  /** Number of currently-connected Viewers (for logging/metrics). */
  get size(): number {
    return this.connections.size;
  }

  /** Fan a server message out to every connected Viewer. */
  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const conn of this.connections) {
      // ws.OPEN === 1; avoid importing the value just for the constant.
      if (conn.socket.readyState === 1) {
        conn.socket.send(data);
      }
    }
  }

  /** Register the `/ws` route on the given Fastify instance. */
  register(app: FastifyInstance): void {
    app.get('/ws', { websocket: true }, (socket) => {
      const conn: Connection = { socket, greeted: false, claimedUserId: null };
      this.connections.add(conn);

      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw.toString()) as ClientMessage;
        } catch {
          this.sendError(conn, 'bad_json', 'message was not valid JSON');
          return;
        }
        this.handle(conn, msg);
      });

      socket.on('close', () => {
        // Release the claim so the avatar can idle-despawn like any other.
        if (conn.claimedUserId) {
          this.room.releaseClaim(conn.claimedUserId);
        }
        this.connections.delete(conn);
      });

      socket.on('error', () => {
        this.connections.delete(conn);
      });
    });
  }

  private handle(conn: Connection, msg: ClientMessage): void {
    switch (msg.type) {
      case 'hello':
        this.onHello(conn, msg.protocolVersion);
        break;
      case 'claim':
        this.onClaim(conn, msg.token);
        break;
      case 'action':
        if (conn.claimedUserId) {
          // The resulting state snapshot is broadcast via room.onChange.
          this.room.applyAction(conn.claimedUserId, msg.action);
        } else {
          this.sendError(conn, 'not_claimed', 'claim your avatar before acting');
        }
        break;
    }
  }

  private onHello(conn: Connection, clientVersion: number): void {
    if (clientVersion !== PROTOCOL_VERSION) {
      this.sendError(
        conn,
        'protocol_mismatch',
        `server speaks protocol v${PROTOCOL_VERSION}, client sent v${clientVersion}`,
      );
      conn.socket.close();
      return;
    }
    conn.greeted = true;
    this.send(conn, {
      type: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      config: this.room.getConfig(),
      state: this.room.snapshot(),
      claimedUserId: conn.claimedUserId,
    });
  }

  private onClaim(conn: Connection, token: string): void {
    // TODO: validate `token` against the streamer-issued session/claim store
    // (see twitch/oauth.ts) to resolve the Twitch userId + displayName. Until
    // OAuth is wired, claims are rejected so we never bind an unverified user.
    void token;
    this.sendError(conn, 'claim_unverified', 'claim validation is not yet wired');
  }

  private send(conn: Connection, msg: ServerMessage): void {
    if (conn.socket.readyState === 1) {
      conn.socket.send(JSON.stringify(msg));
    }
  }

  private sendError(conn: Connection, code: string, message: string): void {
    this.send(conn, { type: 'error', code, message });
  }
}
