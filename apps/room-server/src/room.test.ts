import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, RoomConfig } from '@twitch-room/protocol';
import { Room } from './room.js';

function chat(partial: Partial<ChatMessage> & { userId: string }): ChatMessage {
  return {
    id: partial.id ?? `m-${partial.userId}`,
    channelId: partial.channelId ?? 'chan',
    userId: partial.userId,
    username: partial.username ?? partial.userId,
    displayName: partial.displayName ?? partial.userId,
    color: partial.color,
    text: partial.text ?? 'hello',
    emotes: partial.emotes ?? [],
    badges: partial.badges ?? [],
    timestamp: partial.timestamp ?? 0,
  };
}

function makeConfig(overrides?: Partial<RoomConfig>): RoomConfig {
  return {
    version: 1,
    channel: 'alice',
    theme: { name: 'default' },
    scene: { name: 'lounge' },
    modules: [{ type: 'avatars', enabled: true, params: {} }],
    ...overrides,
  };
}

/** A Room with a controllable clock + deterministic spawn position. */
function makeRoom(opts?: { random?: () => number; config?: RoomConfig }) {
  let clock = 0;
  const persistClaim = vi.fn();
  const room = new Room(opts?.config ?? makeConfig(), {
    now: () => clock,
    random: opts?.random ?? (() => 0.5),
    persistClaim,
  });
  return {
    room,
    persistClaim,
    advance: (dt: number) => {
      clock += dt;
    },
  };
}

describe('Room avatar lifecycle', () => {
  it('spawns an in-bounds avatar on a chatter\'s first message', () => {
    const { room } = makeRoom();
    room.applyChat(chat({ userId: 'u1', displayName: 'User One' }));

    const avatars = room.snapshot().avatars;
    expect(avatars).toHaveLength(1);
    const a = avatars[0]!;
    expect(a.userId).toBe('u1');
    expect(a.displayName).toBe('User One');
    expect(a.claimed).toBe(false);
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x).toBeLessThanOrEqual(1);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeLessThanOrEqual(1);
    expect(a.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('uses the chat color when present and derives a stable one otherwise', () => {
    const { room } = makeRoom();
    room.applyChat(chat({ userId: 'withColor', color: '#123456' }));
    room.applyChat(chat({ userId: 'noColor' }));

    const byId = new Map(room.snapshot().avatars.map((a) => [a.userId, a]));
    expect(byId.get('withColor')!.color).toBe('#123456');
    expect(byId.get('noColor')!.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('refreshes an existing avatar instead of duplicating it', () => {
    const { room } = makeRoom();
    room.applyChat(chat({ userId: 'u1', displayName: 'Old' }));
    room.applyChat(chat({ userId: 'u1', displayName: 'New', color: '#abcdef' }));

    const avatars = room.snapshot().avatars;
    expect(avatars).toHaveLength(1);
    expect(avatars[0]!.displayName).toBe('New');
    expect(avatars[0]!.color).toBe('#abcdef');
  });

  it('bumps seq on each state mutation', () => {
    const { room } = makeRoom();
    const before = room.snapshot().seq;
    room.applyChat(chat({ userId: 'u1' }));
    expect(room.snapshot().seq).toBeGreaterThan(before);
  });

  it('idle-despawns unclaimed avatars only after the timeout elapses', () => {
    const { room, advance } = makeRoom();
    room.applyChat(chat({ userId: 'u1' }));

    advance(299_000);
    expect(room.tick()).toBe(false);
    expect(room.snapshot().avatars).toHaveLength(1);

    advance(2_000); // now past the 300s default
    expect(room.tick()).toBe(true);
    expect(room.snapshot().avatars).toHaveLength(0);
  });

  it('never idle-despawns a claimed avatar', () => {
    const { room, advance } = makeRoom();
    room.claim('u1', 'User One');

    advance(10_000_000);
    expect(room.tick()).toBe(false);
    const a = room.snapshot().avatars[0]!;
    expect(a.claimed).toBe(true);
  });

  it('claim marks the avatar, persists, and spawns one if the user is new', () => {
    const { room, persistClaim } = makeRoom();
    room.claim('u9', 'Niner');

    expect(persistClaim).toHaveBeenCalledWith('u9', 'Niner');
    expect(room.snapshot().avatars[0]!.claimed).toBe(true);
  });

  it('releaseClaim lets a formerly-claimed avatar idle-despawn again', () => {
    const { room, advance } = makeRoom();
    room.claim('u1', 'U');
    room.releaseClaim('u1');
    expect(room.snapshot().avatars[0]!.claimed).toBe(false);

    advance(301_000);
    expect(room.tick()).toBe(true);
    expect(room.snapshot().avatars).toHaveLength(0);
  });

  it('clamps move actions into [0,1] and ignores actions from unknown users', () => {
    const { room } = makeRoom();
    room.applyChat(chat({ userId: 'u1' }));
    room.applyAction('u1', { kind: 'move', x: 1.5, y: -0.3 });
    const a = room.snapshot().avatars[0]!;
    expect(a.x).toBe(1);
    expect(a.y).toBe(0);

    room.applyAction('ghost', { kind: 'move', x: 0.2, y: 0.2 });
    expect(room.snapshot().avatars).toHaveLength(1);
  });

  it('does not bump seq for transient emote actions', () => {
    const { room } = makeRoom();
    room.applyChat(chat({ userId: 'u1' }));
    const seq = room.snapshot().seq;
    room.applyAction('u1', { kind: 'emote', emoteId: 'Kappa' });
    expect(room.snapshot().seq).toBe(seq);
  });

  it('evicts the stalest unclaimed avatar when over the configured cap', () => {
    const config = makeConfig({
      modules: [{ type: 'avatars', enabled: true, params: { maxAvatars: 2 } }],
    });
    const { room, advance } = makeRoom({ config });
    room.applyChat(chat({ userId: 'a' }));
    advance(1_000);
    room.applyChat(chat({ userId: 'b' }));
    advance(1_000);
    room.applyChat(chat({ userId: 'c' })); // at cap -> evict stalest unclaimed (a)

    const ids = room
      .snapshot()
      .avatars.map((a) => a.userId)
      .sort();
    expect(ids).toEqual(['b', 'c']);
  });

  it('notifies onChange subscribers until they unsubscribe', () => {
    const { room } = makeRoom();
    const listener = vi.fn();
    const off = room.onChange(listener);

    room.applyChat(chat({ userId: 'u1' }));
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    room.applyChat(chat({ userId: 'u2' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
