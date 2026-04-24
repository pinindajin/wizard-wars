import Phaser from "phaser"

import { gameConfig } from "./config"
import {
  WW_GAME_CONNECTION_REGISTRY_KEY,
  WW_KEYBIND_CONFIG_REGISTRY_KEY,
  WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
} from "./constants"
import type { KeybindConfig } from "@/shared/gameKeybinds/lobbyKeybinds"
import type { GameConnection } from "./network/GameConnection"

/** Optional injection of the layout-owned Colyseus adapter (single session per user). */
export type CreateGameOptions = {
  readonly gameConnection?: GameConnection
  /** JWT `sub` for the current user; matches `playerId` in game sync payloads. */
  readonly localPlayerId?: string | null
  /** User keybinds from React; falls back if omitted (tests, standalone). */
  readonly keybinds?: KeybindConfig
}

/**
 * Creates the Phaser game instance.
 *
 * @param parent - Optional DOM element or element id to mount the canvas into.
 * @param options - When `gameConnection` is set, it is stored on the game registry in `preBoot` for Arena.
 * @returns The running Phaser.Game instance.
 */
export const createGame = (
  parent?: string | HTMLElement,
  options?: CreateGameOptions,
): Phaser.Game => {
  const injected = options?.gameConnection
  const localPlayerId = options?.localPlayerId
  const keybinds = options?.keybinds
  const needRegistryBoot =
    injected != null || localPlayerId != null || keybinds != null
  const callbacks: Phaser.Types.Core.GameConfig["callbacks"] = {
    preBoot: (game) => {
      if (needRegistryBoot) {
        if (injected) {
          game.registry.set(WW_GAME_CONNECTION_REGISTRY_KEY, injected)
        }
        if (localPlayerId) {
          game.registry.set(WW_LOCAL_PLAYER_ID_REGISTRY_KEY, localPlayerId)
        }
        if (keybinds) {
          game.registry.set(WW_KEYBIND_CONFIG_REGISTRY_KEY, keybinds)
        }
      }
      ;(globalThis as unknown as { __wwGame?: Phaser.Game }).__wwGame = game
    },
  }

  return new Phaser.Game({
    ...gameConfig,
    parent,
    callbacks,
  })
}
