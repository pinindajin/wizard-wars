/**
 * Backward-compatible wrapper. Arena visuals are now owned by Phaser Editor's
 * `Arena.scene`; this script exports that editor data into Phaser/Tiled JSON.
 */
import { exportArenaTilemap } from "./export-arena-tilemap"

exportArenaTilemap()
