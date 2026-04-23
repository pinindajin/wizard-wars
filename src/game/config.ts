import Phaser from "phaser"

import { Boot } from "./scenes/Boot"
import { Preload } from "./scenes/Preload"
import { Arena } from "./scenes/Arena"

/**
 * Core Phaser game configuration.
 * Arena is 1344x768; scale manager fits the canvas to the viewport and centers it.
 */
export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: "#1a1a2e",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1344,
    height: 768,
  },
  scene: [Boot, Preload, Arena],
  render: {
    pixelArt: true,
    antialias: false,
  },
  audio: {
    disableWebAudio: false,
  },
}
