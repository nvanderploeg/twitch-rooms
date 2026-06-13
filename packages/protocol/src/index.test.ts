import { describe, expect, it } from 'vitest';
import type { ChatMessage, ClientMessage, ServerMessage } from './index.js';
import { PROTOCOL_VERSION } from './index.js';

describe('@twitch-room/protocol', () => {
  it('exposes the current numeric PROTOCOL_VERSION', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(typeof PROTOCOL_VERSION).toBe('number');
  });

  it('models a client hello message', () => {
    const msg: ClientMessage = { type: 'hello', protocolVersion: PROTOCOL_VERSION };
    expect(msg.type).toBe('hello');
  });

  it('models a server welcome carrying room config + state', () => {
    const msg: ServerMessage = {
      type: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      claimedUserId: null,
      config: {
        version: 1,
        channel: 'alice',
        theme: { name: 'neon' },
        scene: { name: 'tavern' },
        modules: [{ type: 'avatars', enabled: true, params: {} }],
      },
      state: { channel: 'alice', seq: 0, avatars: [] },
    };
    expect(msg.type).toBe('welcome');
  });

  it('normalizes a chat message shape', () => {
    const chat: ChatMessage = {
      id: 'm1',
      channelId: '1',
      userId: '2',
      username: 'fan',
      displayName: 'Fan',
      text: 'hi',
      emotes: [],
      badges: [],
      timestamp: 0,
    };
    expect(chat.emotes).toHaveLength(0);
  });
});
