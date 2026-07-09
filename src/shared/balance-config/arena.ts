import { GENERATED_ARENA_PROP_COLLIDERS } from "./generated/arena-prop-colliders"
import { GENERATED_ARENA_NON_WALKABLE_COLLIDERS } from "./generated/arena-non-walkable-colliders"
import { GENERATED_ARENA_LAVA_COLLIDERS } from "./generated/arena-lava-colliders"
import { GENERATED_ARENA_CLIFF_COLLIDERS } from "./generated/arena-cliff-colliders"
import { GENERATED_ARENA_LAVA_TRANSITION_COLLIDERS } from "./generated/arena-lava-transition-colliders"
import {
  ARENA_LAYOUT_COLS,
  ARENA_LAYOUT_HEIGHT,
  ARENA_LAYOUT_ROWS,
  ARENA_LAYOUT_SPAWN_POINTS,
  ARENA_LAYOUT_WIDTH,
} from "./arena-layout"

export type ArenaRect = { x: number; y: number; width: number; height: number }

/**
 * Arena geometry constants.
 * Full playable area comes from the committed Arena layout. No decorative
 * ring — the whole tile grid is playable (Decision 87).
 */

export const TILE_SIZE_PX = 64
export const ARENA_COLS = ARENA_LAYOUT_COLS
export const ARENA_ROWS = ARENA_LAYOUT_ROWS
export const ARENA_WIDTH = ARENA_LAYOUT_WIDTH
export const ARENA_HEIGHT = ARENA_LAYOUT_HEIGHT
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
 * Editor-authored non-walkable terrain rectangles. In the current arena these
 * are lava regions: land players may enter them and then lava terrain rules
 * apply.
 */
export const ARENA_NON_WALKABLE_COLLIDERS: readonly {
  x: number
  y: number
  width: number
  height: number
}[] = GENERATED_ARENA_NON_WALKABLE_COLLIDERS

/** Lava rectangles; walkable only after jump/terrain state enters lava. */
export const ARENA_LAVA_COLLIDERS: readonly {
  x: number
  y: number
  width: number
  height: number
}[] = GENERATED_ARENA_LAVA_COLLIDERS

/** Cliff rectangles. The no-cliff lava arena intentionally generates none. */
export const ARENA_CLIFF_COLLIDERS: readonly {
  x: number
  y: number
  width: number
  height: number
}[] = GENERATED_ARENA_CLIFF_COLLIDERS

/**
 * Generated lava transition rectangles retained for arena parity checks. Grounded
 * lava movement now uses terrain center containment instead of these colliders.
 * Regenerate via `bun run build:arena-colliders`.
 */
export const ARENA_LAVA_TRANSITION_COLLIDERS: readonly {
  x: number
  y: number
  width: number
  height: number
}[] = GENERATED_ARENA_LAVA_TRANSITION_COLLIDERS

export function isArenaNonHazardCollider(
  rect: ArenaRect,
  lavaColliders: readonly ArenaRect[] = ARENA_LAVA_COLLIDERS,
  cliffColliders: readonly ArenaRect[] = ARENA_CLIFF_COLLIDERS,
): boolean {
  const overlaps = (other: ArenaRect) =>
    rect.x < other.x + other.width &&
    rect.x + rect.width > other.x &&
    rect.y < other.y + other.height &&
    rect.y + rect.height > other.y

  return !lavaColliders.some(overlaps) && !cliffColliders.some(overlaps)
}

/** Non-walkable rectangles that are neither lava nor cliff. */
export const ARENA_NON_HAZARD_COLLIDERS: readonly {
  x: number
  y: number
  width: number
  height: number
}[] = ARENA_NON_WALKABLE_COLLIDERS.filter((rect) => isArenaNonHazardCollider(rect))

/**
 * Static rectangles that block grounded land movement. Lava is excluded so
 * players can walk or be pushed off walkable terrain into lava from any edge.
 */
export const ARENA_WORLD_COLLIDERS: readonly {
  x: number
  y: number
  width: number
  height: number
}[] = [...ARENA_PROP_COLLIDERS, ...ARENA_NON_HAZARD_COLLIDERS, ...ARENA_CLIFF_COLLIDERS]

/** Fireball despawns this many pixels past any arena edge. */
export const FIREBALL_DESPAWN_OVERSHOOT_PX = 400

/** Props block fireballs (fireball despawns on prop collision). */
export const FIREBALL_BLOCKED_BY_PROPS = true

/** Lightning bolt and axe swing pass through props. */
export const LIGHTNING_PASSES_THROUGH_PROPS = true
export const AXE_PASSES_THROUGH_PROPS = true
