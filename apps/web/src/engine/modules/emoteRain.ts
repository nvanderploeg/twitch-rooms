import { Graphics, Ticker } from 'pixi.js';
import type { ChatMessage } from '@twitch-room/protocol';
import type { ModuleContext, RoomModule } from './types.js';

interface Drop {
  graphic: Graphics;
  vy: number;
}

const FALL_SPEED = 2;
const DROP_SIZE = 12;

/**
 * Spawns a falling graphic for each incoming chat message. Minimal but
 * functional: a small square drifts down and is recycled once off-screen.
 * Rendering real emote textures from `msg.emotes` is a TODO.
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

  onChat(_msg: ChatMessage): void {
    if (!this.ctx) {
      return;
    }
    const width = this.ctx.app.screen.width;
    const graphic = new Graphics().rect(0, 0, DROP_SIZE, DROP_SIZE).fill(0xffd166);
    graphic.position.set(Math.random() * Math.max(width - DROP_SIZE, 0), -DROP_SIZE);
    this.ctx.layer.addChild(graphic);
    this.drops.add({ graphic, vy: FALL_SPEED });
    // TODO: build a sprite from the first emote in _msg.emotes when present.
  }

  private update(deltaTime: number): void {
    if (!this.ctx) {
      return;
    }
    const height = this.ctx.app.screen.height;
    for (const drop of this.drops) {
      drop.graphic.position.y += drop.vy * deltaTime;
      if (drop.graphic.position.y > height) {
        drop.graphic.destroy();
        this.drops.delete(drop);
      }
    }
  }

  destroy(): void {
    if (this.ctx && this.tick) {
      this.ctx.app.ticker.remove(this.tick);
    }
    for (const drop of this.drops) {
      drop.graphic.destroy();
    }
    this.drops.clear();
    this.tick = null;
    this.ctx = null;
  }
}
