import Phaser from "phaser"

import { Boot } from "./scenes/Boot"
import { Preload } from "./scenes/Preload"
import { Arena } from "./scenes/Arena"

/**
 * Core Phaser game configuration.
 * Canvas 1344x768, zoom 1, dark navy background.
 */
export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1344,
  height: 768,
  zoom: 1,
  backgroundColor: "#1a1a2e",
  scene: [Boot, Preload, Arena],
  render: {
    pixelArt: true,
    antialias: false,
  },
  audio: {
    disableWebAudio: false,
  },
}
