import Phaser from "phaser"

import Arena from "./scenes/Arena"
import { Boot } from "./scenes/Boot"
import { Preload } from "./scenes/Preload"

/**
 * Core Phaser game configuration.
 * Canvas is 1344×768; the playable world uses `ARENA_WIDTH`×`ARENA_HEIGHT` from
 * shared balance-config. Scale manager fits the canvas to the viewport and centers it.
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
  // Note: we intentionally do NOT set `loader.baseURL`. Phaser concatenates
  // `baseURL + url`, so `baseURL="/"` + `url="/assets/..."` produces
  // `//assets/...` which the browser interprets as a protocol-relative URL
  // with hostname "assets" → ERR_NAME_NOT_RESOLVED. Every pack URL is already
  // absolute (leading `/`) — both in the 3 pack JSONs and the `load.pack(...)`
  // calls in Boot/Preload/Arena — which is the real fix for the asset path
  // bug on /lobby/<id>/game/.
}
