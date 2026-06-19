/**
 * worldCollisionSystem – repairs dirty player positions against arena bounds
 * and static world colliders.
 *
 * Delegates to the shared `resolveAgainstWorld` math so the client's
 * rewind-and-replay path can run identical collision resolution.
 */
import { query, hasComponent, removeComponent } from "bitecs"

import {
  Position,
  PlayerTag,
  JumpArc,
  TerrainState,
  TERRAIN_KIND_TO_STATE,
  NeedsWorldCollisionResolution,
} from "../components"
import type { SimCtx } from "../simulation"
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
} from "../../../shared/balance-config"
import {
  resolveAgainstWorld,
  type ArenaPropColliderRect,
} from "../../../shared/collision/worldCollision"
import {
  canOccupyWorldPositionIndexed,
  resolveAgainstWorldIndexed,
} from "../../../shared/collision/indexedWorldCollision"
import {
  terrainColliderSetForPlayerState,
  type IndexedColliderSet,
} from "../../../shared/collision/arenaSpatialIndexes"
import type {
  ArenaBounds,
  WorldCollisionFootprint,
} from "../../../shared/collision/worldCollision"

export type { ArenaPropColliderRect } from "../../../shared/collision/worldCollision"

const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

type WorldCollisionResolutionDeps = {
  readonly canOccupy: (
    x: number,
    y: number,
    footprint: WorldCollisionFootprint,
    bounds: ArenaBounds,
    colliderSet: IndexedColliderSet,
  ) => boolean
  readonly resolve: (
    x: number,
    y: number,
    footprint: WorldCollisionFootprint,
    bounds: ArenaBounds,
    colliderSet: IndexedColliderSet,
  ) => { readonly x: number; readonly y: number }
}

const DEFAULT_WORLD_COLLISION_DEPS: WorldCollisionResolutionDeps = {
  canOccupy: canOccupyWorldPositionIndexed,
  resolve: resolveAgainstWorldIndexed,
}

/**
 * Pushes one player oval out of static axis-aligned rectangles and clamps
 * it against the arena bounds (shared with sim tests + client replay).
 *
 * @param eid - Player entity id with valid `Position`.
 * @param colliders - Footprint rectangles in world pixels.
 */
export function resolvePlayerAgainstPropColliders(
  eid: number,
  colliders: readonly ArenaPropColliderRect[],
): void {
  const out = resolveAgainstWorld(
    Position.x[eid],
    Position.y[eid],
    PLAYER_WORLD_COLLISION_FOOTPRINT,
    ARENA_BOUNDS,
    colliders,
  )
  Position.x[eid] = out.x
  Position.y[eid] = out.y
}

/**
 * Repairs one dirty player position and clears the repair tag.
 *
 * Legal dirty positions use a cheap occupancy check and skip the more expensive
 * resolution path. This covers defensive tags from spawn/respawn/landing while
 * still repairing player-player shoves that enter static world geometry.
 *
 * @param world - ECS world containing the player entity.
 * @param eid - Player entity id.
 * @param deps - Collision functions, injectable for unit tests.
 */
export function resolveDirtyPlayerWorldCollision(
  world: SimCtx["world"],
  eid: number,
  deps: WorldCollisionResolutionDeps = DEFAULT_WORLD_COLLISION_DEPS,
): void {
  const jumpZ = hasComponent(world, eid, JumpArc) ? JumpArc.z[eid] : 0
  const terrainState = TERRAIN_KIND_TO_STATE[TerrainState.kind[eid]] ?? "land"
  const jumpStartedInLava =
    hasComponent(world, eid, JumpArc) && JumpArc.startedInLava[eid] === 1
  const colliderSet = terrainColliderSetForPlayerState(jumpZ, terrainState, {
    jumpStartedInLava,
  })

  if (
    deps.canOccupy(
      Position.x[eid],
      Position.y[eid],
      PLAYER_WORLD_COLLISION_FOOTPRINT,
      ARENA_BOUNDS,
      colliderSet,
    )
  ) {
    removeComponent(world, eid, NeedsWorldCollisionResolution)
    return
  }

  const out = deps.resolve(
    Position.x[eid],
    Position.y[eid],
    PLAYER_WORLD_COLLISION_FOOTPRINT,
    ARENA_BOUNDS,
    colliderSet,
  )
  Position.x[eid] = out.x
  Position.y[eid] = out.y
  removeComponent(world, eid, NeedsWorldCollisionResolution)
}

/**
 * Runs the world collision system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function worldCollisionSystem(ctx: SimCtx): void {
  const { world } = ctx

  for (const eid of query(world, [PlayerTag, NeedsWorldCollisionResolution])) {
    resolveDirtyPlayerWorldCollision(world, eid)
  }
}
