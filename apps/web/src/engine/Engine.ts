import { Application, Container } from 'pixi.js';
import type { ChatMessage, RoomConfig, RoomState } from '@twitch-room/protocol';
import { instantiateModules } from './modules/registry.js';
import type { ModuleContext, RoomModule } from './modules/types.js';

const DEFAULT_BACKGROUND = 0x101218;

interface MountedModule {
  module: RoomModule;
  layer: Container;
}

/**
 * The Engine wraps a single {@link Application}. It reads a {@link RoomConfig},
 * applies the theme/scene background, instantiates the enabled Modules via the
 * registry, and forwards state/chat updates to them.
 */
export class Engine {
  private app: Application | null = null;
  private modules: MountedModule[] = [];

  /**
   * Create the Pixi application on the given canvas and bring up Modules.
   * Pixi v8 initialization is async.
   */
  async create(canvas: HTMLCanvasElement, config: RoomConfig): Promise<void> {
    const app = new Application();
    await app.init({
      canvas,
      background: resolveBackground(config),
      resizeTo: canvas.parentElement ?? canvas,
      antialias: true,
    });
    this.app = app;

    // TODO: apply scene background asset (config.scene.backgroundUrl) and
    // theme accent/palette beyond the flat background color.

    for (const { module, config: moduleConfig } of instantiateModules(config.modules)) {
      const layer = new Container();
      app.stage.addChild(layer);
      const ctx: ModuleContext = { app, layer, config: moduleConfig };
      module.init(ctx);
      this.modules.push({ module, layer });
    }
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

  /** Tear down Modules and the Pixi application. */
  destroy(): void {
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
