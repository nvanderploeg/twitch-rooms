import { Application, Container } from 'pixi.js';
import type { ChatMessage, RoomConfig, RoomState } from '@twitch-room/protocol';
import { instantiateModules } from './modules/registry.js';
import type { CanvasSize, ModuleContext, RoomModule } from './modules/types.js';

const DEFAULT_BACKGROUND = 0x101218;

interface MountedModule {
  module: RoomModule;
  layer: Container;
}

/**
 * The Engine wraps a single {@link Application}. It reads a {@link RoomConfig},
 * applies the theme/scene background, instantiates the enabled Modules via the
 * registry, observes canvas resizes, and forwards state/chat updates to them.
 */
export class Engine {
  private app: Application | null = null;
  private modules: MountedModule[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private resizeTarget: HTMLElement | null = null;

  /**
   * Create the Pixi application on the given canvas and bring up Modules.
   * Pixi v8 initialization is async.
   */
  async create(canvas: HTMLCanvasElement, config: RoomConfig): Promise<void> {
    const resizeTarget = canvas.parentElement ?? canvas;
    const app = new Application();
    await app.init({
      canvas,
      background: resolveBackground(config),
      resizeTo: resizeTarget,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    this.app = app;

    for (const { module, config: moduleConfig } of instantiateModules(config.modules)) {
      const layer = new Container();
      app.stage.addChild(layer);
      const ctx: ModuleContext = {
        app,
        layer,
        config: moduleConfig,
        getSize: () => this.getSize(),
      };
      module.init(ctx);
      this.modules.push({ module, layer });
    }

    // Observe the drawable area; Pixi's `resizeTo` resizes the renderer, and we
    // additionally notify modules so normalized coords re-scale to the new size.
    if (resizeTarget instanceof HTMLElement && typeof ResizeObserver !== 'undefined') {
      this.resizeTarget = resizeTarget;
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(resizeTarget);
    }
  }

  /** Current drawable size in CSS pixels (post-resolution screen size). */
  getSize(): CanvasSize {
    if (!this.app) {
      return { width: 0, height: 0 };
    }
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  /** Forward an authoritative state snapshot to every Module. */
  setState(state: RoomState): void {
    for (const { module } of this.modules) {
      module.onState?.(state);
    }
  }

  /** Forward a chat message to every Module. */
  pushChat(msg: ChatMessage): void {
    for (const { module } of this.modules) {
      module.onChat?.(msg);
    }
  }

  /** Tear down Modules, the resize observer, and the Pixi application. */
  destroy(): void {
    if (this.resizeObserver && this.resizeTarget) {
      this.resizeObserver.unobserve(this.resizeTarget);
      this.resizeObserver.disconnect();
    }
    this.resizeObserver = null;
    this.resizeTarget = null;

    for (const { module } of this.modules) {
      module.destroy();
    }
    this.modules = [];
    if (this.app) {
      // Do not destroy the caller-owned canvas; React controls its lifecycle.
      this.app.destroy(false, { children: true });
      this.app = null;
    }
  }

  private handleResize(): void {
    if (!this.app) {
      return;
    }
    // Pixi's `resizeTo` updates `app.screen` on its own RAF; force it now so the
    // size we hand modules is current.
    this.app.resize();
    const size = this.getSize();
    for (const { module } of this.modules) {
      module.onResize?.(size);
    }
  }
}

function resolveBackground(config: RoomConfig): number {
  const bg = config.theme.background;
  if (bg && bg.startsWith('#')) {
    const value = Number.parseInt(bg.slice(1), 16);
    if (!Number.isNaN(value)) {
      return value;
    }
  }
  // TODO: support image/asset-url backgrounds (load as a sprite layer).
  return DEFAULT_BACKGROUND;
}
