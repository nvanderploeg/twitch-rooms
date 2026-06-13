import { Graphics } from 'pixi.js';
import type { AvatarState, RoomState } from '@twitch-room/protocol';
import type { ModuleContext, RoomModule } from './types.js';

const AVATAR_RADIUS = 16;
const DEFAULT_COLOR = 0x4f9dff;

/**
 * Renders one graphic per {@link AvatarState}, positioned by its scene x/y.
 * Minimal but functional: a colored circle per avatar, reconciled on each state
 * update. Real sprites/animations are a TODO.
 */
export class AvatarsModule implements RoomModule {
  readonly type = 'avatars' as const;
  private ctx: ModuleContext | null = null;
  private readonly sprites = new Map<string, Graphics>();

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    // TODO: read params (e.g. avatar asset set, scale) from ctx.config.params.
  }

  onState(state: RoomState): void {
    if (!this.ctx) {
      return;
    }
    const seen = new Set<string>();
    for (const avatar of state.avatars) {
      seen.add(avatar.userId);
      this.upsertAvatar(avatar);
    }
    // Remove avatars no longer present.
    for (const [userId, sprite] of this.sprites) {
      if (!seen.has(userId)) {
        sprite.destroy();
        this.sprites.delete(userId);
      }
    }
  }

  private upsertAvatar(avatar: AvatarState): void {
    if (!this.ctx) {
      return;
    }
    let sprite = this.sprites.get(avatar.userId);
    if (!sprite) {
      sprite = new Graphics();
      this.sprites.set(avatar.userId, sprite);
      this.ctx.layer.addChild(sprite);
    }
    const color = parseColor(avatar.color) ?? DEFAULT_COLOR;
    sprite.clear();
    sprite.circle(0, 0, AVATAR_RADIUS).fill(color);
    sprite.position.set(avatar.x, avatar.y);
    sprite.alpha = avatar.claimed ? 1 : 0.6;
    // TODO: render displayName label and badges.
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) {
      sprite.destroy();
    }
    this.sprites.clear();
    this.ctx = null;
  }
}

function parseColor(color: string | undefined): number | null {
  if (!color) {
    return null;
  }
  const hex = color.replace('#', '');
  const value = Number.parseInt(hex, 16);
  return Number.isNaN(value) ? null : value;
}
