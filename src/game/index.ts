import Phaser from "phaser"

import { gameConfig } from "./config"
import {
  WW_ACTIVE_LOCAL_INPUT_CALLBACK_REGISTRY_KEY,
  WW_ABILITY_SLOTS_REGISTRY_KEY,
  WW_GAME_CONNECTION_REGISTRY_KEY,
  WW_KEYBIND_CONFIG_REGISTRY_KEY,
  WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
  WW_MINIMAP_CORNER_REGISTRY_KEY,
  WW_PREDICTION_CORRECTION_CALLBACK_REGISTRY_KEY,
} from "./constants"
import type { KeybindConfig } from "@/shared/gameKeybinds/lobbyKeybinds"
import type { MinimapCorner } from "@/shared/settings-config"
import type { GameConnection } from "./network/GameConnection"
import type { RubberbandCorrection } from "@/shared/performanceIndicators"

/** Optional injection of the layout-owned Colyseus adapter (single session per user). */
export type CreateGameOptions = {
  readonly gameConnection?: GameConnection
  /** JWT `sub` for the current user; matches `playerId` in game sync payloads. */
  readonly localPlayerId?: string | null
  /** User keybinds from React; falls back if omitted (tests, standalone). */
  readonly keybinds?: KeybindConfig
  /** Persisted compact minimap corner from React settings. */
  readonly minimapCorner?: MinimapCorner
  /** Current local ability-bar slot ids from React shop state. */
  readonly abilitySlots?: readonly (string | null)[]
  /** Reports local prediction reconciliation classifications to React. */
  readonly onPredictionCorrection?: (correction: RubberbandCorrection) => void
  /** Reports active local input samples to React for stale-message gating. */
  readonly onActiveLocalInput?: () => void
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
  const minimapCorner = options?.minimapCorner
  const abilitySlots = options?.abilitySlots
  const onPredictionCorrection = options?.onPredictionCorrection
  const onActiveLocalInput = options?.onActiveLocalInput
  const needRegistryBoot =
    injected != null ||
    localPlayerId != null ||
    keybinds != null ||
    minimapCorner != null ||
    abilitySlots != null ||
    onPredictionCorrection != null ||
    onActiveLocalInput != null
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
        if (minimapCorner) {
          game.registry.set(WW_MINIMAP_CORNER_REGISTRY_KEY, minimapCorner)
        }
        if (abilitySlots) {
          game.registry.set(WW_ABILITY_SLOTS_REGISTRY_KEY, [...abilitySlots])
        }
        if (onPredictionCorrection) {
          game.registry.set(
            WW_PREDICTION_CORRECTION_CALLBACK_REGISTRY_KEY,
            onPredictionCorrection,
          )
        }
        if (onActiveLocalInput) {
          game.registry.set(
            WW_ACTIVE_LOCAL_INPUT_CALLBACK_REGISTRY_KEY,
            onActiveLocalInput,
          )
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
