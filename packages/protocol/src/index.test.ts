import { describe, expect, it } from 'vitest';
import type { Placeholder } from './index';
import { PROTOCOL_VERSION } from './index';

describe('@twitch-room/protocol', () => {
  it('exposes a numeric PROTOCOL_VERSION starting at 0', () => {
    expect(PROTOCOL_VERSION).toBe(0);
    expect(typeof PROTOCOL_VERSION).toBe('number');
  });

  it('models a placeholder message with the expected discriminator', () => {
    const message: Placeholder = { type: 'placeholder' };
    expect(message.type).toBe('placeholder');
  });
});
