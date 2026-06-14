import { Assets, Container, Graphics, Sprite, Ticker } from 'pixi.js';
import type { ChatMessage } from '@twitch-room/protocol';
import type { ModuleContext, RoomModule } from './types.js';

interface Drop {
  display: Container;
  vy: number;
}

const FALL_SPEED = 2;
const EMOTE_SIZE = 32;
const GENERIC_SIZE = 12;
/** Cap concurrent drops so a chat burst can't unbound the scene. */
const MAX_DROPS = 120;
/** Cap emotes spawned per message. */
const MAX_PER_MESSAGE = 5;

/** Twitch emote CDN url for a given emote id (2x dark theme). */
function emoteUrl(id: string): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;
}

/**
 * Rains a falling sprite for each emote in an incoming chat message, loading the
 * real texture from the Twitch emote CDN. Messages with no emotes spawn a small
 * generic particle so chat activity is still visible. Drops are recycled once
 * off-screen and capped to keep the scene bounded.
 */
export class EmoteRainModule implements RoomModule {
  readonly type = 'emoteRain' as const;
  private ctx: ModuleContext | null = null;
  private readonly drops = new Set<Drop>();
  private tick: ((ticker: Ticker) => void) | null = null;

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    this.tick = (ticker: Ticker) => this.update(ticker.deltaTime);
    ctx.app.ticker.add(this.tick);
    // TODO: read params (e.g. density, gravity) from ctx.config.params.
  }

  onChat(msg: ChatMessage): void {
    if (!this.ctx) {
      return;
    }
    if (msg.emotes.length > 0) {
      for (const emote of msg.emotes.slice(0, MAX_PER_MESSAGE)) {
        void this.spawnEmote(emoteUrl(emote.id));
      }
    } else {
      this.spawnGeneric();
    }
  }

  private async spawnEmote(url: string): Promise<void> {
    if (!this.ctx || this.drops.size >= MAX_DROPS) {
      return;
    }
    let texture;
    try {
      texture = await Assets.load(url);
    } catch {
      // Emote CDN miss/offline — skip silently rather than break the rain.
      return;
    }
    // The module may have been destroyed while the texture loaded.
    if (!this.ctx) {
      return;
    }
    const sprite = new Sprite(texture);
    sprite.width = EMOTE_SIZE;
    sprite.height = EMOTE_SIZE;
    this.placeAndAdd(sprite, EMOTE_SIZE);
  }

  private spawnGeneric(): void {
    if (!this.ctx || this.drops.size >= MAX_DROPS) {
      return;
    }
    const graphic = new Graphics().rect(0, 0, GENERIC_SIZE, GENERIC_SIZE).fill(0xffd166);
    this.placeAndAdd(graphic, GENERIC_SIZE);
  }

  private placeAndAdd(display: Container, size: number): void {
    if (!this.ctx) {
      display.destroy();
      return;
    }
    const width = this.ctx.app.screen.width;
    display.position.set(Math.random() * Math.max(width - size, 0), -size);
    this.ctx.layer.addChild(display);
    this.drops.add({ display, vy: FALL_SPEED + Math.random() * 1.5 });
  }

  private update(deltaTime: number): void {
    if (!this.ctx) {
      return;
    }
    const height = this.ctx.app.screen.height;
    for (const drop of this.drops) {
      drop.display.position.y += drop.vy * deltaTime;
      if (drop.display.position.y > height) {
        drop.display.destroy();
        this.drops.delete(drop);
      }
    }
  }

  destroy(): void {
    if (this.ctx && this.tick) {
      this.ctx.app.ticker.remove(this.tick);
    }
    for (const drop of this.drops) {
      drop.display.destroy();
    }
    this.drops.clear();
    this.tick = null;
    this.ctx = null;
  }
}
