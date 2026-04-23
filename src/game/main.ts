import type { GameConnection } from "./network/GameConnection"

import { createGame } from "./index"

/** Re-export for Arena and tests. */
export {
  WW_GAME_CONNECTION_REGISTRY_KEY,
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
}

/**
 * Mounts the Phaser game into the specified container and stores join metadata
 * in sessionStorage so Arena can fall back to `connect()` in non-React entrypoints.
 * Returns a teardown function that destroys the game instance.
 *
 * @param options - Mount configuration from the React host component.
 * @returns A function that destroys the Phaser game and cleans up.
 */
export const mountGame = (options: MountGameOptions): (() => void) => {
  const { containerId, lobbyId, token, gameConnection, localPlayerId } = options

  sessionStorage.setItem(
    "ww_join_options",
    JSON.stringify({ token, lobbyId }),
  )

  const game = createGame(containerId, { gameConnection, localPlayerId })

  return () => {
    game.destroy(true)
    sessionStorage.removeItem("ww_join_options")
  }
}
