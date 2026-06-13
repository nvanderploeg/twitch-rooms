import type { Application, Container } from 'pixi.js';
import type {
  ChatMessage,
  ModuleConfig,
  ModuleType,
  RoomState,
} from '@twitch-room/protocol';

/**
 * Everything a Module needs to render and react. The Engine builds one context
 * per Module instance and hands it to {@link RoomModule.init}.
 */
export interface ModuleContext {
  /** The shared Pixi application. */
  app: Application;
  /**
   * A dedicated Pixi container for this Module's display objects. The Engine
   * owns adding/removing it from the stage so Modules stay isolated.
   */
  layer: Container;
  /** This Module's config entry, including its `params`. */
  config: ModuleConfig;
}

/**
 * A built-in Module the Engine can run in a Room. Lifecycle: `init` once, then
 * `onState`/`onChat` as updates arrive, then `destroy` on teardown.
 */
export interface RoomModule {
  readonly type: ModuleType;
  init(ctx: ModuleContext): void;
  onState?(state: RoomState): void;
  onChat?(msg: ChatMessage): void;
  destroy(): void;
}
