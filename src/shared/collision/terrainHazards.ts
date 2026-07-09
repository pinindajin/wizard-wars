import {
  ARENA_CLIFF_COLLIDERS,
  ARENA_LAVA_COLLIDERS,
  ARENA_NON_HAZARD_COLLIDERS,
  ARENA_PROP_COLLIDERS,
  ARENA_WORLD_COLLIDERS,
} from "../balance-config/arena"
import { JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX } from "../balance-config/combat"
import type { PlayerTerrainState } from "../types"
import { ARENA_LAVA_COLLIDER_SET } from "./arenaSpatialIndexes"
import { effectiveTerrainStateForCurrentArena } from "./effectiveTerrainState"
import { queryPointIds } from "./spatialIndex"
import type { ArenaPropColliderRect, WorldCandidateGate } from "./worldCollision"

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
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height,
  )
}

export function terrainStateAtPosition(x: number, y: number): PlayerTerrainState {
  if (pointInRects(x, y, ARENA_LAVA_COLLIDERS)) return "lava"
  if (pointInRects(x, y, ARENA_CLIFF_COLLIDERS)) return "cliff"
  return "land"
}

/**
 * Returns whether a point samples as lava using the arena lava spatial index.
 *
 * @param x - Candidate player center x in world pixels.
 * @param y - Candidate player center y in world pixels.
 * @returns True when the candidate center samples as lava.
 */
export function groundedLavaCandidateCanOccupy(x: number, y: number): boolean {
  return queryPointIds(
    ARENA_LAVA_COLLIDER_SET.index,
    x,
    y,
    ARENA_LAVA_COLLIDER_SET.scratch,
  ).length > 0
}

/**
 * Returns the optional candidate gate for movement in the current terrain state.
 *
 * @param jumpZ - Simulated jump height in world pixels.
 * @param terrainState - Current authoritative terrain state.
 * @returns Undefined for normal movement; lava/land transitions are collider-legal.
 */
export function worldCandidateGateForPlayerState(
  jumpZ: number,
  terrainState: PlayerTerrainState,
): WorldCandidateGate | undefined {
  const effectiveTerrainState = effectiveTerrainStateForCurrentArena(terrainState)
  if (jumpZ > 0) return undefined
  if (effectiveTerrainState === "lava") return undefined
  return undefined
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
  const effectiveTerrainState = effectiveTerrainStateForCurrentArena(terrainState)
  if (jumpZ > 0) {
    if (options?.jumpStartedInLava === true) {
      return ARENA_PROP_COLLIDERS
    }
    if (jumpZ < JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX) {
      return ARENA_PROP_COLLIDERS
    }
    return AIRBORNE_COLLIDERS_WITH_LAVA
  }
  if (effectiveTerrainState === "lava") {
    return [
      ...ARENA_PROP_COLLIDERS,
      ...ARENA_NON_HAZARD_COLLIDERS,
      ...ARENA_CLIFF_COLLIDERS,
    ]
  }
  if (effectiveTerrainState === "cliff") {
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
