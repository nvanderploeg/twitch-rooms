import { describe, expect, it } from 'vitest';
import { parseChatMessage, type ChatMessageEvent } from './chat-parse.js';

function event(overrides?: Partial<ChatMessageEvent>): ChatMessageEvent {
  return {
    message_id: 'msg-1',
    broadcaster_user_id: 'b1',
    chatter_user_id: 'c1',
    chatter_user_login: 'fan42',
    chatter_user_name: 'Fan42',
    color: '#FF0000',
    message: {
      text: 'hi Kappa!',
      fragments: [
        { type: 'text', text: 'hi ' },
        { type: 'emote', text: 'Kappa', emote: { id: '25' } },
        { type: 'text', text: '!' },
      ],
    },
    badges: [{ set_id: 'subscriber', id: '12' }],
    ...overrides,
  };
}

describe('parseChatMessage', () => {
  it('maps identity, text, badges, and color', () => {
    const msg = parseChatMessage(event());
    expect(msg.id).toBe('msg-1');
    expect(msg.channelId).toBe('b1');
    expect(msg.userId).toBe('c1');
    expect(msg.username).toBe('fan42');
    expect(msg.displayName).toBe('Fan42');
    expect(msg.text).toBe('hi Kappa!');
    expect(msg.color).toBe('#FF0000');
    expect(msg.badges).toEqual([{ setId: 'subscriber', id: '12' }]);
    expect(typeof msg.timestamp).toBe('number');
  });

  it('computes emote offsets over the message fragments', () => {
    const msg = parseChatMessage(event());
    // "hi Kappa!" -> 'Kappa' occupies indices 3..7 inclusive.
    expect(msg.emotes).toEqual([{ id: '25', name: 'Kappa', start: 3, end: 7 }]);
    expect(msg.text.slice(3, 8)).toBe('Kappa');
  });

  it('omits color when the chatter has not set one', () => {
    const msg = parseChatMessage(event({ color: '' }));
    expect(msg).not.toHaveProperty('color');
  });

  it('yields no emotes for a plain-text message', () => {
    const msg = parseChatMessage(
      event({ message: { text: 'just text', fragments: [{ type: 'text', text: 'just text' }] } }),
    );
    expect(msg.emotes).toEqual([]);
  });
});
