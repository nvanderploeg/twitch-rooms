import { Container, Graphics, Text } from 'pixi.js';
import type { Ticker } from 'pixi.js';
import type { AvatarState, ChatMessage, RoomState } from '@twitch-room/protocol';
import { normalizedToPixel } from '../coords.js';
import type { CanvasSize, ModuleContext, RoomModule } from './types.js';

const AVATAR_RADIUS = 16;
const DEFAULT_COLOR = 0x4f9dff;
/** Fraction of the remaining distance covered per frame (~60fps) tween. */
const LERP_FACTOR = 0.18;
/** Speech bubble lifetime in milliseconds. */
const BUBBLE_TTL_MS = 3000;
/** Reaction bounce duration in milliseconds. */
const BOUNCE_MS = 450;
/** Max characters shown in a speech bubble before truncation. */
const BUBBLE_MAX_CHARS = 48;

interface AvatarView {
  /** Container holding the circle + label; positioned in pixel space. */
  root: Container;
  circle: Graphics;
  label: Text;
  /** Normalized target position from the latest state. */
  nx: number;
  ny: number;
  /** Current pixel position (lerps toward the scaled target). */
  px: number;
  py: number;
  bubble: SpeechBubble | null;
  /** Remaining bounce time in ms; 0 when idle. */
  bounceMs: number;
}

interface SpeechBubble {
  container: Container;
  ttlMs: number;
}

/**
 * Renders each {@link AvatarState} as a labeled token (colored circle plus a
 * display-name label) at its normalized scene position scaled to the canvas.
 * Reconciles on every state update and plays a brief bounce + speech bubble
 * reaction when its owner chats.
 */
export class AvatarsModule implements RoomModule {
  readonly type = 'avatars' as const;
  private ctx: ModuleContext | null = null;
  private readonly views = new Map<string, AvatarView>();
  private tick: ((ticker: Ticker) => void) | null = null;

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    this.tick = (ticker: Ticker) => this.update(ticker.deltaTime, ticker.deltaMS);
    ctx.app.ticker.add(this.tick);
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
    for (const [userId, view] of this.views) {
      if (!seen.has(userId)) {
        view.root.destroy({ children: true });
        this.views.delete(userId);
      }
    }
  }

  onChat(msg: ChatMessage): void {
    const view = this.views.get(msg.userId);
    if (!view || !this.ctx) {
      return;
    }
    view.bounceMs = BOUNCE_MS;
    this.showBubble(view, msg.text);
  }

  onResize(_size: CanvasSize): void {
    // Snap existing avatars to their rescaled targets so a resize doesn't drag
    // tokens across the canvas via the lerp.
    if (!this.ctx) {
      return;
    }
    const { width, height } = this.ctx.getSize();
    for (const view of this.views.values()) {
      const { px, py } = normalizedToPixel(view.nx, view.ny, width, height);
      view.px = px;
      view.py = py;
      view.root.position.set(px, py);
    }
  }

  private upsertAvatar(avatar: AvatarState): void {
    if (!this.ctx) {
      return;
    }
    const color = parseColor(avatar.color) ?? DEFAULT_COLOR;
    const { width, height } = this.ctx.getSize();
    const target = normalizedToPixel(avatar.x, avatar.y, width, height);

    let view = this.views.get(avatar.userId);
    if (!view) {
      const root = new Container();
      const circle = new Graphics().circle(0, 0, AVATAR_RADIUS).fill(color);
      const label = new Text({
        text: avatar.displayName,
        style: {
          fill: 0xffffff,
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
          align: 'center',
        },
      });
      label.anchor.set(0.5, 0);
      label.position.set(0, AVATAR_RADIUS + 4);
      root.addChild(circle, label);
      root.position.set(target.px, target.py);
      this.ctx.layer.addChild(root);
      view = {
        root,
        circle,
        label,
        nx: avatar.x,
        ny: avatar.y,
        px: target.px,
        py: target.py,
        bubble: null,
        bounceMs: 0,
      };
      this.views.set(avatar.userId, view);
    } else {
      if (view.label.text !== avatar.displayName) {
        view.label.text = avatar.displayName;
      }
      view.circle.clear().circle(0, 0, AVATAR_RADIUS).fill(color);
    }

    view.nx = avatar.x;
    view.ny = avatar.y;
    view.root.alpha = avatar.claimed ? 1 : 0.6;
  }

  private showBubble(view: AvatarView, text: string): void {
    if (!this.ctx) {
      return;
    }
    if (view.bubble) {
      view.bubble.container.destroy({ children: true });
      view.bubble = null;
    }
    const truncated =
      text.length > BUBBLE_MAX_CHARS ? `${text.slice(0, BUBBLE_MAX_CHARS - 1)}…` : text;

    const container = new Container();
    const label = new Text({
      text: truncated,
      style: {
        fill: 0x101218,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        wordWrap: true,
        wordWrapWidth: 180,
      },
    });
    label.position.set(8, 6);
    const padW = label.width + 16;
    const padH = label.height + 12;
    const bg = new Graphics().roundRect(0, 0, padW, padH, 8).fill(0xf4f4f4);
    container.addChild(bg, label);
    // Center the bubble above the avatar's head.
    container.position.set(-padW / 2, -(AVATAR_RADIUS + padH + 6));
    view.root.addChild(container);
    view.bubble = { container, ttlMs: BUBBLE_TTL_MS };
  }

  private update(_deltaTime: number, deltaMS: number): void {
    if (!this.ctx) {
      return;
    }
    const { width, height } = this.ctx.getSize();
    for (const view of this.views.values()) {
      const target = normalizedToPixel(view.nx, view.ny, width, height);
      view.px += (target.px - view.px) * LERP_FACTOR;
      view.py += (target.py - view.py) * LERP_FACTOR;
      view.root.position.set(view.px, view.py);

      // Bounce: scale pulse that decays over BOUNCE_MS.
      if (view.bounceMs > 0) {
        view.bounceMs = Math.max(0, view.bounceMs - deltaMS);
        const progress = 1 - view.bounceMs / BOUNCE_MS;
        const pulse = 1 + 0.3 * Math.sin(progress * Math.PI);
        view.circle.scale.set(pulse);
      } else if (view.circle.scale.x !== 1) {
        view.circle.scale.set(1);
      }

      // Speech bubble fade-out.
      if (view.bubble) {
        view.bubble.ttlMs -= deltaMS;
        if (view.bubble.ttlMs <= 0) {
          view.bubble.container.destroy({ children: true });
          view.bubble = null;
        } else if (view.bubble.ttlMs < 600) {
          view.bubble.container.alpha = view.bubble.ttlMs / 600;
        }
      }
    }
  }

  destroy(): void {
    if (this.ctx && this.tick) {
      this.ctx.app.ticker.remove(this.tick);
    }
    for (const view of this.views.values()) {
      view.root.destroy({ children: true });
    }
    this.views.clear();
    this.tick = null;
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
