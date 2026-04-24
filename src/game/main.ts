import type Phaser from "phaser"

import type { KeybindConfig } from "@/shared/gameKeybinds/lobbyKeybinds"
import type { GameConnection } from "./network/GameConnection"

import { createGame } from "./index"

/** Re-export for Arena and tests. */
export {
  WW_GAME_CONNECTION_REGISTRY_KEY,
  WW_KEYBIND_CONFIG_REGISTRY_KEY,
  WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
} from "./constants"

/** Options passed from the React host component to mount the Phaser game. */
export interface MountGameOptions {
  /** DOM element id that Phaser will render the canvas inside. */
  containerId: string
  /** Colyseus room id for the active match. */
  lobbyId: string
  /** Session JWT for reconnect (`ww-token` is HttpOnly — must come from `/api/auth/ws-token`). */
  token: string
  /**
   * Layout-owned connection (single Colyseus seat). Injected via Phaser `preBoot` registry.
   */
  gameConnection: GameConnection
  /** Auth user id (JWT `sub`); same as `playerId` in network payloads. */
  localPlayerId: string | null
  /** User keybinds (React); Phaser input matches the lobby settings modal. */
  keybinds?: KeybindConfig
}

/** Handle returned from {@link mountGame}. */
export type MountedGame = {
  /** The running Phaser game instance — exposed for loader-status subscriptions. */
  readonly game: Phaser.Game
  /** Destroys the Phaser game and cleans up sessionStorage. */
  readonly destroy: () => void
}

/**
 * Mounts the Phaser game into the specified container and stores join metadata
 * in sessionStorage so Arena can fall back to `connect()` in non-React entrypoints.
 * Returns the `Phaser.Game` handle plus a teardown function.
 *
 * @param options - Mount configuration from the React host component.
 * @returns An object containing the `game` handle and a `destroy` teardown fn.
 */
export const mountGame = (options: MountGameOptions): MountedGame => {
  const { containerId, lobbyId, token, gameConnection, localPlayerId, keybinds } = options

  sessionStorage.setItem(
    "ww_join_options",
    JSON.stringify({ token, lobbyId }),
  )

  const game = createGame(containerId, { gameConnection, localPlayerId, keybinds })

  if (typeof window !== "undefined") {
    const w = window as Window & {
      __wwRoomId?: string
      __wwLobbyId?: string
    }
    w.__wwRoomId = gameConnection.room?.roomId
    w.__wwLobbyId = lobbyId
  }

  return {
    game,
    destroy: () => {
      if (typeof window !== "undefined") {
        const w = window as Window & {
          __wwRoomId?: string
          __wwLobbyId?: string
        }
        delete w.__wwRoomId
        delete w.__wwLobbyId
      }
      game.destroy(true)
      sessionStorage.removeItem("ww_join_options")
    },
  }
}
