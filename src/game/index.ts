import Phaser from "phaser"

import { gameConfig } from "./config"

/**
 * Creates and exports the singleton Phaser game instance.
 * Call this once from the page/component that mounts the game canvas.
 *
 * @param parent - Optional DOM element or element id to mount the canvas into.
 * @returns The running Phaser.Game instance.
 */
export const createGame = (parent?: string | HTMLElement): Phaser.Game => {
  return new Phaser.Game({ ...gameConfig, parent })
}
