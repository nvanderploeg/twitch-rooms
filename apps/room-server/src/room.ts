/**
 * The authoritative Room.
 *
 * Owns the single in-memory RoomState (channel, seq, avatars) for this Room
 * Server. The scene is driven by chat: every chatter gets an avatar that spawns
 * on their first message and is despawned after a period of inactivity, so the
 * Room reflects who is *currently* talking. A logged-in Viewer may claim their
 * avatar to control it; claimed avatars persist (they are not idle-despawned)
 * until released. The monotonic `seq` lets Viewers order/dedupe the full-snapshot
 * broadcasts.
 *
 * The Room is deliberately pure: it owns no timers, no sockets, and no database.
 * Callers drive it (`applyChat`, `applyAction`, `tick`, ...) and subscribe via
 * `onChange` to learn when to re-broadcast; persistence is injected. This keeps
 * the core simulation unit-testable in isolation.
 */
import type {
  AvatarState,
  ChatColor,
  ChatMessage,
  RoomConfig,
  RoomState,
  ViewerAction,
} from '@twitch-room/protocol';

/**
 * Internal avatar record. Mirrors the wire `AvatarState` plus bookkeeping that
 * stays server-side (`lastActiveAt` drives idle despawn).
 */
interface AvatarRecord {
  userId: string;
  displayName: string;
  color: ChatColor;
  /** Normalized scene position in [0, 1]; the client scales to its canvas. */
  x: number;
  y: number;
  claimed: boolean;
  /** Epoch ms of the avatar's last activity (chat, move, or claim). */
  lastActiveAt: number;
}

/** Tunables read from the `avatars` Module config, with defaults. */
interface AvatarLifecycle {
  /** Unclaimed avatars are despawned after this much inactivity. */
  idleTimeoutMs: number;
  /** Cap on concurrent avatars; spawning past it evicts the stalest unclaimed. */
  maxAvatars: number;
}

/** Injectable seams so the simulation is deterministic under test. */
export interface RoomOptions {
  /** Clock source (defaults to `Date.now`). */
  now?: () => number;
  /** Uniform [0, 1) source for spawn positions (defaults to `Math.random`). */
  random?: () => number;
  /** Persist a claim (defaults to a no-op; `index.ts` wires SQLite). */
  persistClaim?: (userId: string, displayName: string) => void;
}

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_AVATARS = 200;
/** Margin kept clear of the scene edges when spawning, in normalized units. */
const SPAWN_MARGIN = 0.08;

/**
 * Default name colors, mirroring Twitch's palette, used when a chatter has not
 * set a color. Picked deterministically per user so an avatar's color is stable.
 */
const DEFAULT_COLORS: readonly ChatColor[] = [
  '#FF0000',
  '#0000FF',
  '#008000',
  '#B22222',
  '#FF7F50',
  '#9ACD32',
  '#FF4500',
  '#2E8B57',
  '#DAA520',
  '#D2691E',
  '#5F9EA0',
  '#1E90FF',
  '#FF69B4',
  '#8A2BE2',
  '#00FF7F',
];

/** Stable color choice for a user without a chat color (FNV-1a over the id). */
function deriveColor(userId: string): ChatColor {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const index = Math.abs(hash) % DEFAULT_COLORS.length;
  return DEFAULT_COLORS[index] ?? '#FFFFFF';
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Read avatar-lifecycle tunables from the enabled `avatars` Module config. */
function readLifecycle(config: RoomConfig): AvatarLifecycle {
  const mod = config.modules.find((m) => m.type === 'avatars' && m.enabled);
  const params = (mod?.params ?? {}) as {
    idleTimeoutSeconds?: unknown;
    maxAvatars?: unknown;
  };
  const idleSeconds =
    typeof params.idleTimeoutSeconds === 'number' && params.idleTimeoutSeconds > 0
      ? params.idleTimeoutSeconds
      : DEFAULT_IDLE_TIMEOUT_MS / 1000;
  const maxAvatars =
    typeof params.maxAvatars === 'number' && params.maxAvatars > 0
      ? Math.floor(params.maxAvatars)
      : DEFAULT_MAX_AVATARS;
  return { idleTimeoutMs: idleSeconds * 1000, maxAvatars };
}

function toAvatarState(a: AvatarRecord): AvatarState {
  return {
    userId: a.userId,
    displayName: a.displayName,
    color: a.color,
    x: a.x,
    y: a.y,
    claimed: a.claimed,
  };
}

export class Room {
  private channel: string;
  private seq = 0;
  /** Avatars keyed by Twitch user id for O(1) lookup; snapshot flattens to array. */
  private readonly avatars = new Map<string, AvatarRecord>();
  private config: RoomConfig;
  private lifecycle: AvatarLifecycle;

  private readonly nowFn: () => number;
  private readonly randomFn: () => number;
  private readonly persistClaim: (userId: string, displayName: string) => void;
  /** Subscribers notified after any state mutation (used to drive broadcasts). */
  private readonly listeners = new Set<() => void>();

  constructor(config: RoomConfig, options: RoomOptions = {}) {
    this.config = config;
    this.channel = config.channel;
    this.lifecycle = readLifecycle(config);
    this.nowFn = options.now ?? (() => Date.now());
    this.randomFn = options.random ?? Math.random;
    this.persistClaim = options.persistClaim ?? (() => {});
  }

  /**
   * Subscribe to state changes. The listener fires once per mutation, after
   * `seq` has been bumped; call `snapshot()` inside it to read the new state.
   * Returns an unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Swap in a new RoomConfig (e.g. after the Streamer edits it via the panel). */
  reconfigure(config: RoomConfig): void {
    this.config = config;
    this.channel = config.channel;
    this.lifecycle = readLifecycle(config);
    this.touch();
  }

  /** The currently-loaded RoomConfig. */
  getConfig(): RoomConfig {
    return this.config;
  }

  /**
   * Ensure an avatar exists for a chatter (spawning one on first message) and
   * refresh its activity. Called for every ingested chat message so the scene is
   * populated purely from chat.
   */
  applyChat(msg: ChatMessage): void {
    const existing = this.avatars.get(msg.userId);
    if (existing) {
      // Keep display data fresh; chatters can change name/color over time.
      existing.displayName = msg.displayName;
      if (msg.color) {
        existing.color = msg.color;
      }
      existing.lastActiveAt = this.nowFn();
    } else {
      this.spawn(msg.userId, msg.displayName, msg.color ?? deriveColor(msg.userId));
    }
    this.touch();
  }

  /**
   * Apply a claimed Viewer's web-side action to their avatar. No-op if the user
   * has no avatar yet (they must exist — via chat or claim — to act).
   */
  applyAction(userId: string, action: ViewerAction): void {
    const avatar = this.avatars.get(userId);
    if (!avatar) {
      return;
    }
    switch (action.kind) {
      case 'move':
        avatar.x = clamp01(action.x);
        avatar.y = clamp01(action.y);
        avatar.lastActiveAt = this.nowFn();
        this.touch();
        break;
      case 'emote':
      case 'module':
        // Transient / not modelled in v1 snapshots (no persistent state change),
        // so they don't bump seq. TODO: surface these as per-action scene events
        // once the protocol carries broadcastable action events.
        break;
    }
  }

  /**
   * Bind a Twitch user to their avatar (creating one if they have not chatted
   * yet) and mark it claimed. Claimed avatars are not idle-despawned. Persists
   * the claim for reconnect.
   */
  claim(userId: string, displayName: string): void {
    const avatar =
      this.avatars.get(userId) ?? this.spawn(userId, displayName, deriveColor(userId));
    avatar.claimed = true;
    avatar.displayName = displayName;
    avatar.lastActiveAt = this.nowFn();
    this.persistClaim(userId, displayName);
    this.touch();
  }

  /**
   * Release a claim (e.g. the controlling Viewer disconnected). The avatar
   * becomes unclaimed and will idle-despawn like any chat-driven avatar.
   */
  releaseClaim(userId: string): void {
    const avatar = this.avatars.get(userId);
    if (!avatar || !avatar.claimed) {
      return;
    }
    avatar.claimed = false;
    avatar.lastActiveAt = this.nowFn();
    this.touch();
  }

  /**
   * Despawn unclaimed avatars that have been inactive past the idle timeout.
   * Driven by a periodic caller (see `index.ts`). Returns whether anything was
   * removed (in which case `onChange` listeners have already fired).
   */
  tick(now: number = this.nowFn()): boolean {
    let removed = false;
    for (const [id, avatar] of this.avatars) {
      if (!avatar.claimed && now - avatar.lastActiveAt > this.lifecycle.idleTimeoutMs) {
        this.avatars.delete(id);
        removed = true;
      }
    }
    if (removed) {
      this.touch();
    }
    return removed;
  }

  /** Full authoritative snapshot to broadcast to Viewers. */
  snapshot(): RoomState {
    return {
      channel: this.channel,
      seq: this.seq,
      avatars: [...this.avatars.values()].map(toAvatarState),
    };
  }

  /** Number of avatars currently in the Room (for logging/metrics). */
  get population(): number {
    return this.avatars.size;
  }

  /** Spawn a fresh unclaimed avatar at a random in-bounds position. */
  private spawn(userId: string, displayName: string, color: ChatColor): AvatarRecord {
    this.ensureCapacity();
    const span = 1 - 2 * SPAWN_MARGIN;
    const record: AvatarRecord = {
      userId,
      displayName,
      color,
      x: SPAWN_MARGIN + this.randomFn() * span,
      y: SPAWN_MARGIN + this.randomFn() * span,
      claimed: false,
      lastActiveAt: this.nowFn(),
    };
    this.avatars.set(userId, record);
    return record;
  }

  /** Evict the stalest unclaimed avatar if the Room is at capacity. */
  private ensureCapacity(): void {
    if (this.avatars.size < this.lifecycle.maxAvatars) {
      return;
    }
    let stalestId: string | undefined;
    let stalest = Infinity;
    for (const [id, avatar] of this.avatars) {
      if (!avatar.claimed && avatar.lastActiveAt < stalest) {
        stalest = avatar.lastActiveAt;
        stalestId = id;
      }
    }
    // If every avatar is claimed we let the Room grow rather than drop a claim.
    if (stalestId !== undefined) {
      this.avatars.delete(stalestId);
    }
  }

  /** Bump the sequence and notify subscribers of a state change. */
  private touch(): void {
    this.seq += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
