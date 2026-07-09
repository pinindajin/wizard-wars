import {
  ARENA_CLIFF_COLLIDERS,
  ARENA_LAVA_COLLIDERS,
  ARENA_NON_HAZARD_COLLIDERS,
  ARENA_PROP_COLLIDERS,
  ARENA_WORLD_COLLIDERS,
  TILE_SIZE_PX,
} from "../balance-config/arena"
import { JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX } from "../balance-config/combat"
import type { PlayerTerrainState } from "../types"
import { effectiveTerrainStateForCurrentArena } from "./effectiveTerrainState"
import type { ArenaPropColliderRect } from "./worldCollision"
import { createSpatialQueryScratch, createStaticAabbIndex } from "./spatialIndex"
import type { StaticAabbIndex, SpatialQueryScratch } from "./spatialIndex"

export type IndexedColliderSet = {
  readonly rects: readonly ArenaPropColliderRect[]
  readonly index: StaticAabbIndex<ArenaPropColliderRect>
  readonly scratch: SpatialQueryScratch
}

const AIRBORNE_COLLIDERS_WITH_LAVA: readonly ArenaPropColliderRect[] = [
  ...ARENA_PROP_COLLIDERS,
  ...ARENA_LAVA_COLLIDERS,
]

const LAVA_TERRAIN_COLLIDERS: readonly ArenaPropColliderRect[] = [
  ...ARENA_PROP_COLLIDERS,
  ...ARENA_NON_HAZARD_COLLIDERS,
  ...ARENA_CLIFF_COLLIDERS,
]

const CLIFF_TERRAIN_COLLIDERS: readonly ArenaPropColliderRect[] = [
  ...ARENA_PROP_COLLIDERS,
  ...ARENA_NON_HAZARD_COLLIDERS,
]

export const ARENA_WORLD_COLLIDER_SET = createIndexedColliderSet(ARENA_WORLD_COLLIDERS)
export const ARENA_LAVA_COLLIDER_SET = createIndexedColliderSet(ARENA_LAVA_COLLIDERS)
export const ARENA_CLIFF_COLLIDER_SET = createIndexedColliderSet(ARENA_CLIFF_COLLIDERS)
export const ARENA_PROP_COLLIDER_SET = createIndexedColliderSet(ARENA_PROP_COLLIDERS)

export const AIRBORNE_COLLIDERS_WITH_LAVA_SET =
  createIndexedColliderSet(AIRBORNE_COLLIDERS_WITH_LAVA)
export const LAVA_TERRAIN_COLLIDER_SET = createIndexedColliderSet(LAVA_TERRAIN_COLLIDERS)
export const CLIFF_TERRAIN_COLLIDER_SET = createIndexedColliderSet(CLIFF_TERRAIN_COLLIDERS)

export function terrainColliderSetForPlayerState(
  jumpZ: number,
  terrainState: PlayerTerrainState,
  options?: { readonly jumpStartedInLava?: boolean },
): IndexedColliderSet {
  const effectiveTerrainState = effectiveTerrainStateForCurrentArena(terrainState)
  if (jumpZ > 0) {
    if (options?.jumpStartedInLava === true) return ARENA_PROP_COLLIDER_SET
    if (jumpZ < JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX) return ARENA_PROP_COLLIDER_SET
    return AIRBORNE_COLLIDERS_WITH_LAVA_SET
  }
  if (effectiveTerrainState === "lava") return LAVA_TERRAIN_COLLIDER_SET
  if (effectiveTerrainState === "cliff") return CLIFF_TERRAIN_COLLIDER_SET
  return ARENA_WORLD_COLLIDER_SET
}

function createIndexedColliderSet(
  rects: readonly ArenaPropColliderRect[],
): IndexedColliderSet {
  return {
    rects,
    index: createStaticAabbIndex(rects, { cellSizePx: TILE_SIZE_PX }),
    scratch: createSpatialQueryScratch(),
  }
}
