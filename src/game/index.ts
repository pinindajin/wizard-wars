import Phaser from "phaser"

import { gameConfig } from "./config"
import {
  WW_GAME_CONNECTION_REGISTRY_KEY,
  WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
} from "./constants"
import type { GameConnection } from "./network/GameConnection"

/** Optional injection of the layout-owned Colyseus adapter (single session per user). */
export type CreateGameOptions = {
  readonly gameConnection?: GameConnection
  /** JWT `sub` for the current user; matches `playerId` in game sync payloads. */
  readonly localPlayerId?: string | null
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
  const callbacks: Phaser.Types.Core.GameConfig["callbacks"] =
    injected != null || localPlayerId
      ? {
          preBoot: (game) => {
            if (injected) {
              game.registry.set(WW_GAME_CONNECTION_REGISTRY_KEY, injected)
            }
            if (localPlayerId) {
              game.registry.set(WW_LOCAL_PLAYER_ID_REGISTRY_KEY, localPlayerId)
            }
          },
        }
      : undefined

  return new Phaser.Game({
    ...gameConfig,
    parent,
    callbacks,
  })
}
