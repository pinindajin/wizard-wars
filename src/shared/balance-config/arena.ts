import { GENERATED_ARENA_PROP_COLLIDERS } from "./generated/arena-prop-colliders"
import {
  GENERATED_ARENA_COLS,
  GENERATED_ARENA_ROWS,
  GENERATED_ARENA_SPAWN_POINTS,
} from "./generated/arena-layout"

/**
 * Arena geometry constants.
 * Full playable area comes from the generated Phaser Editor/Pixellab arena
 * layout. No decorative ring — the whole tile grid is playable (Decision 87).
 */

export const TILE_SIZE_PX = 64
export const ARENA_COLS = GENERATED_ARENA_COLS
export const ARENA_ROWS = GENERATED_ARENA_ROWS
export const ARENA_WIDTH = ARENA_COLS * TILE_SIZE_PX
export const ARENA_HEIGHT = ARENA_ROWS * TILE_SIZE_PX
export const ARENA_CENTER_X = ARENA_WIDTH / 2
export const ARENA_CENTER_Y = ARENA_HEIGHT / 2

/**
 * Legacy approximate spawn radius retained for modules that import it. PixelLab
 * arenas use generated safe spawn coordinates rather than a strict ring.
 */
export const ARENA_SPAWN_RING_RADIUS_PX = Math.round(Math.min(ARENA_WIDTH, ARENA_HEIGHT) * 0.32)

/** Number of generated safe spawn points. */
export const SPAWN_POINT_COUNT = GENERATED_ARENA_SPAWN_POINTS.length

/**
 * Canonical safe spawn points generated from the current arena layout. These
 * are kept out of lava and lava-transition tiles by the PixelLab importer.
 */
export const ARENA_SPAWN_POINTS: readonly { x: number; y: number }[] =
  GENERATED_ARENA_SPAWN_POINTS

/**
 * Static prop collider records: { x, y, width, height } rectangles (base footprint only).
 * Regenerate from Tiled via `bun run build:arena-colliders` (layer **PropColliders**).
 */
export const ARENA_PROP_COLLIDERS: readonly {
  x: number
  y: number
  width: number
  height: number
}[] = GENERATED_ARENA_PROP_COLLIDERS

/** Fireball despawns this many pixels past any arena edge. */
export const FIREBALL_DESPAWN_OVERSHOOT_PX = 400

/** Props block fireballs (fireball despawns on prop collision). */
export const FIREBALL_BLOCKED_BY_PROPS = true

/** Lightning bolt and axe swing pass through props. */
export const LIGHTNING_PASSES_THROUGH_PROPS = true
export const AXE_PASSES_THROUGH_PROPS = true
