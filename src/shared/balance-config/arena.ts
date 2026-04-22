import { combineDamageProperties, DamageProperty } from "./damage"

/**
 * Arena geometry constants.
 * Full playable area is a 21×12 grid of 64×64 tiles = 1344×768 px.
 * No decorative ring — the whole tile grid is playable (Decision 87).
 */

export const TILE_SIZE_PX = 64
export const ARENA_COLS = 21
export const ARENA_ROWS = 12
export const ARENA_WIDTH = ARENA_COLS * TILE_SIZE_PX // 1344
export const ARENA_HEIGHT = ARENA_ROWS * TILE_SIZE_PX // 768
export const ARENA_CENTER_X = ARENA_WIDTH / 2 // 672
export const ARENA_CENTER_Y = ARENA_HEIGHT / 2 // 384

/** Radius of the circular spawn-point ring around arena center. */
export const ARENA_SPAWN_RING_RADIUS_PX = 300

/** Number of distinct spawn points on the ring. */
export const SPAWN_POINT_COUNT = 12

/**
 * The 12 canonical spawn points on the ring, evenly spaced every 30°.
 * Index 0 is at angle 0 (right of center), proceeding clockwise.
 * If fewer than 12 valid Phaser Editor markers are loaded at runtime, these are the fallback.
 *
 * @remarks Coords are (cx + r*cos(θ), cy + r*sin(θ)) with θ = index * 30° (in radians).
 */
export const ARENA_SPAWN_POINTS: readonly { x: number; y: number }[] = Array.from(
  { length: SPAWN_POINT_COUNT },
  (_, i) => {
    const angleDeg = i * 30
    const angleRad = (angleDeg * Math.PI) / 180
    return {
      x: Math.round(ARENA_CENTER_X + ARENA_SPAWN_RING_RADIUS_PX * Math.cos(angleRad)),
      y: Math.round(ARENA_CENTER_Y + ARENA_SPAWN_RING_RADIUS_PX * Math.sin(angleRad)),
    }
  },
)

/**
 * Static prop collider records: { x, y, width, height } rectangles (base footprint only).
 * Populated by the compile-arena-colliders.ts script reading arena.json.
 * Fallback to empty array before generation.
 */
export const ARENA_PROP_COLLIDERS: readonly {
  x: number
  y: number
  width: number
  height: number
}[] = []

/** Fireball despawns this many pixels past any arena edge. */
export const FIREBALL_DESPAWN_OVERSHOOT_PX = 400

/** Props block fireballs (fireball despawns on prop collision). */
export const FIREBALL_BLOCKED_BY_PROPS = true

/** Lightning bolt and axe swing pass through props. */
export const LIGHTNING_PASSES_THROUGH_PROPS = true
export const AXE_PASSES_THROUGH_PROPS = true
