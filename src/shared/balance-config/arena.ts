import { GENERATED_ARENA_PROP_COLLIDERS } from "./generated/arena-prop-colliders"
import {
  ARENA_LAYOUT_COLS,
  ARENA_LAYOUT_ROWS,
  ARENA_LAYOUT_SPAWN_POINTS,
  ARENA_LAYOUT_TERRAIN_COLLIDERS,
} from "./arena-layout"

/**
 * Arena geometry constants.
 * Full playable area comes from the committed Arena layout. No decorative
 * ring — the whole tile grid is playable (Decision 87).
 */

export const TILE_SIZE_PX = 64
export const ARENA_COLS = ARENA_LAYOUT_COLS
export const ARENA_ROWS = ARENA_LAYOUT_ROWS
export const ARENA_WIDTH = ARENA_COLS * TILE_SIZE_PX
export const ARENA_HEIGHT = ARENA_ROWS * TILE_SIZE_PX
export const ARENA_CENTER_X = ARENA_WIDTH / 2
export const ARENA_CENTER_Y = ARENA_HEIGHT / 2

/**
 * Legacy approximate spawn radius retained for modules that import it. Arena
 * gameplay uses committed safe spawn coordinates rather than a strict ring.
 */
export const ARENA_SPAWN_RING_RADIUS_PX = Math.round(Math.min(ARENA_WIDTH, ARENA_HEIGHT) * 0.32)

/** Number of generated safe spawn points. */
export const SPAWN_POINT_COUNT = ARENA_LAYOUT_SPAWN_POINTS.length

/**
 * Canonical safe spawn points for the current arena layout. These are kept out
 * of lava and lava-transition terrain.
 */
export const ARENA_SPAWN_POINTS: readonly { x: number; y: number }[] =
  ARENA_LAYOUT_SPAWN_POINTS

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

/**
 * Terrain collider records for lava and lava-transition tiles.
 * Dirt terrain stays walkable; lava and lava-transition terrain block their cells.
 */
export const ARENA_TERRAIN_COLLIDERS: readonly {
  x: number
  y: number
  width: number
  height: number
}[] = ARENA_LAYOUT_TERRAIN_COLLIDERS

/** All static rectangles that block player movement. */
export const ARENA_WORLD_COLLIDERS: readonly {
  x: number
  y: number
  width: number
  height: number
}[] = [...ARENA_PROP_COLLIDERS, ...ARENA_TERRAIN_COLLIDERS]

/** Fireball despawns this many pixels past any arena edge. */
export const FIREBALL_DESPAWN_OVERSHOOT_PX = 400

/** Props block fireballs (fireball despawns on prop collision). */
export const FIREBALL_BLOCKED_BY_PROPS = true

/** Lightning bolt and axe swing pass through props. */
export const LIGHTNING_PASSES_THROUGH_PROPS = true
export const AXE_PASSES_THROUGH_PROPS = true
