import type { Room } from "@colyseus/sdk"

import { createGame } from "./index"

/** Options passed from the React host component to mount the Phaser game. */
export interface MountGameOptions {
  /** DOM element id that Phaser will render the canvas inside. */
  containerId: string
  /** Colyseus room id for the active match. */
  lobbyId: string
  /**
   * Pre-authenticated Colyseus room from the React host.
   * Passed to GameConnection so we can skip a second join call.
   */
  room: Room | null
}

/**
 * Mounts the Phaser game into the specified container and stores join metadata
 * in sessionStorage so the Arena scene can reconnect if needed.
 * Returns a teardown function that destroys the game instance.
 *
 * @param options - Mount configuration from the React host component.
 * @returns A function that destroys the Phaser game and cleans up.
 */
export const mountGame = (options: MountGameOptions): (() => void) => {
  const { containerId, lobbyId } = options

  // Persist join options so GameConnection can read them on scene boot
  const token = _readWwToken()
  sessionStorage.setItem(
    "ww_join_options",
    JSON.stringify({ token, lobbyId }),
  )

  const game = createGame(containerId)

  return () => {
    game.destroy(true)
    sessionStorage.removeItem("ww_join_options")
  }
}

/**
 * Reads the `ww-token` cookie value for use in the Colyseus join options.
 *
 * @returns The JWT token string, or empty string if not found.
 */
function _readWwToken(): string {
  if (typeof document === "undefined") return ""
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith("ww-token="))
  return match ? match.split("=").slice(1).join("=") : ""
}
