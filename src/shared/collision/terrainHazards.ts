import {
  ARENA_CLIFF_COLLIDERS,
  ARENA_LAVA_COLLIDERS,
  ARENA_LAVA_TRANSITION_COLLIDERS,
  ARENA_NON_HAZARD_COLLIDERS,
  ARENA_PROP_COLLIDERS,
  ARENA_WORLD_COLLIDERS,
} from "../balance-config/arena"
import { JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX } from "../balance-config/combat"
import type { PlayerTerrainState } from "../types"
import type { ArenaPropColliderRect } from "./worldCollision"

export type TerrainColliderMode = PlayerTerrainState

/** Options for {@link worldCollidersForPlayerState} (airborne jump escape vs gap-tightening). */
export type WorldCollidersForPlayerOptions = {
  /**
   * When true, horizontal collision while `jumpZ > 0` uses props only (jump began in lava).
   * When false/omitted and `jumpZ > 0`, lava AABBs participate so gaps cannot be skimmed from land.
   */
  readonly jumpStartedInLava?: boolean
}

/** Airborne jumps that began on land: block horizontal skim over lava pools. */
const AIRBORNE_COLLIDERS_WITH_LAVA: readonly ArenaPropColliderRect[] = [
  ...ARENA_PROP_COLLIDERS,
  ...ARENA_LAVA_COLLIDERS,
]

export function rectsOverlap(
  a: ArenaPropColliderRect,
  b: ArenaPropColliderRect,
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

export function pointInRects(
  x: number,
  y: number,
  rects: readonly ArenaPropColliderRect[],
): boolean {
  return rects.some((rect) =>
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height,
  )
}

export function terrainStateAtPosition(x: number, y: number): PlayerTerrainState {
  if (pointInRects(x, y, ARENA_LAVA_COLLIDERS)) return "lava"
  if (pointInRects(x, y, ARENA_CLIFF_COLLIDERS)) return "cliff"
  return "land"
}

/**
 * Returns static colliders for horizontal movement / resolve for the given jump height and terrain.
 *
 * @param jumpZ - Simulated vertical offset (world px); `0` when grounded.
 * @param terrainState - Land / lava / cliff hazard state for grounded or low-hop rules.
 * @param options - Airborne escape-from-lava vs lava-blocking arc.
 */
export function worldCollidersForPlayerState(
  jumpZ: number,
  terrainState: PlayerTerrainState,
  options?: WorldCollidersForPlayerOptions,
): readonly ArenaPropColliderRect[] {
  if (jumpZ > 0) {
    if (options?.jumpStartedInLava === true) {
      return ARENA_PROP_COLLIDERS
    }
    if (jumpZ < JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX) {
      return ARENA_PROP_COLLIDERS
    }
    return AIRBORNE_COLLIDERS_WITH_LAVA
  }
  if (terrainState === "lava") {
    return [
      ...ARENA_PROP_COLLIDERS,
      ...ARENA_NON_HAZARD_COLLIDERS,
      ...ARENA_CLIFF_COLLIDERS,
      ...ARENA_LAVA_TRANSITION_COLLIDERS,
    ]
  }
  if (terrainState === "cliff") {
    return [...ARENA_PROP_COLLIDERS, ...ARENA_NON_HAZARD_COLLIDERS]
  }
  return ARENA_WORLD_COLLIDERS
}

export function nearestLavaCenter(
  x: number,
  y: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number; distSq: number } | null = null
  for (const rect of ARENA_LAVA_COLLIDERS) {
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    const dx = cx - x
    const dy = cy - y
    const distSq = dx * dx + dy * dy
    if (!best || distSq < best.distSq) best = { x: cx, y: cy, distSq }
  }
  return best ? { x: best.x, y: best.y } : null
}
