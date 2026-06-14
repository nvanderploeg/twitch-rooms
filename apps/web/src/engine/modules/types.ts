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
  /**
   * Current canvas size in pixels. Modules call this to scale normalized
   * [0, 1] scene coordinates; the value tracks live resizes.
   */
  getSize: () => CanvasSize;
}

/** Current drawable canvas size in CSS pixels. */
export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * Optional hook a Module can implement to react to canvas resizes (e.g.
 * reposition normalized-coordinate display objects). The Engine calls this with
 * the new size whenever the drawable area changes.
 */
export interface ResizableModule {
  onResize(size: CanvasSize): void;
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
  /** Called when the canvas is resized so normalized coords can re-scale. */
  onResize?(size: CanvasSize): void;
  destroy(): void;
}
