import type { ModuleConfig, ModuleType } from '@twitch-room/protocol';
import type { RoomModule } from './types.js';
import { AvatarsModule } from './avatars.js';
import { EmoteRainModule } from './emoteRain.js';

/**
 * Maps each built-in {@link ModuleType} to a factory. Modules not yet
 * implemented are absent; `instantiateModules` skips them.
 */
export const MODULE_REGISTRY: Partial<Record<ModuleType, () => RoomModule>> = {
  avatars: () => new AvatarsModule(),
  emoteRain: () => new EmoteRainModule(),
  // TODO: implement 'polls' and 'chatFeed' modules.
};

/**
 * Build module instances for the enabled, registered entries of a Room Config.
 * Returns each instance paired with its config so the Engine can wire contexts.
 */
export function instantiateModules(
  configs: ModuleConfig[],
): Array<{ module: RoomModule; config: ModuleConfig }> {
  const result: Array<{ module: RoomModule; config: ModuleConfig }> = [];
  for (const config of configs) {
    if (!config.enabled) {
      continue;
    }
    const factory = MODULE_REGISTRY[config.type];
    if (!factory) {
      // TODO: warn/telemetry for configured-but-unimplemented module types.
      continue;
    }
    result.push({ module: factory(), config });
  }
  return result;
}
