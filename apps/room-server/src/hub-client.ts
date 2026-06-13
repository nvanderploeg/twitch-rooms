/**
 * Hub directory registration + heartbeat (the Room Server -> Hub link).
 *
 * The Hub is only a directory (ADR-0001): on boot the Room Server registers its
 * Public Endpoint, then heartbeats so the Hub keeps the Room marked online. No
 * live Room traffic touches the Hub. The Bearer registration token proves this
 * Streamer may register `channel` (ADR-0002).
 */
import {
  PROTOCOL_VERSION,
  type HeartbeatRequest,
  type RegisterRequest,
  type RegisterResponse,
} from '@twitch-room/protocol';

import { config } from './config.js';

/** Fallback heartbeat cadence if the Hub does not specify one. */
const DEFAULT_HEARTBEAT_MS = 30_000;
/** Backoff bounds for failed registration attempts. */
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Manages this Room Server's directory presence: register (with retry/backoff),
 * then heartbeat on the Hub-provided interval. Failures are logged and retried;
 * the Room Server keeps serving Viewers regardless (the Hub is not in the path).
 */
export class HubClient {
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private backoff = MIN_BACKOFF_MS;
  private stopped = false;

  /** Begin the register-then-heartbeat lifecycle (does not block boot). */
  start(): void {
    this.stopped = false;
    void this.registerWithRetry();
  }

  /** Stop heartbeating (on shutdown). */
  stop(): void {
    this.stopped = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private async registerWithRetry(): Promise<void> {
    while (!this.stopped) {
      try {
        const intervalMs = await this.register();
        console.log('[hub-client] registered; heartbeat every', intervalMs, 'ms');
        this.backoff = MIN_BACKOFF_MS;
        this.startHeartbeat(intervalMs);
        return;
      } catch (err) {
        console.error(
          `[hub-client] registration failed (${(err as Error).message}); retrying in ${this.backoff}ms`,
        );
        await delay(this.backoff);
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  /** POST the registration; resolves to the heartbeat interval to use. */
  private async register(): Promise<number> {
    const body: RegisterRequest = {
      channel: config.channel,
      publicEndpoint: config.publicEndpoint,
      protocolVersion: PROTOCOL_VERSION,
    };
    const res = await fetch(`${config.hubUrl}/api/rooms/register`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.registrationToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`register HTTP ${res.status}`);
    }
    // TODO: validate the response shape rather than trusting the cast.
    const json = (await res.json()) as RegisterResponse;
    return json.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, intervalMs);
    this.heartbeatTimer.unref();
  }

  private async heartbeat(): Promise<void> {
    const body: HeartbeatRequest = { channel: config.channel };
    try {
      const res = await fetch(`${config.hubUrl}/api/rooms/heartbeat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.registrationToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // A 404/410 likely means the Hub forgot us (restart); re-register.
        console.warn('[hub-client] heartbeat HTTP', res.status, '— re-registering');
        this.stop();
        this.start();
      }
    } catch (err) {
      console.warn('[hub-client] heartbeat failed:', (err as Error).message);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
