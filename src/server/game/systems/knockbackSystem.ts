/**
 * knockbackSystem – applies pending Knockback impulses to entity positions.
 *
 * Each tick, the entity is pushed in the normalised impulse direction by the
 * remaining distance budget, reducing remainingPx toward zero.  When the
 * budget is exhausted the Knockback component is removed.
 */
import { query, hasComponent, removeComponent } from "bitecs"

import {
  Position,
  Knockback,
  PlayerTag,
  FireballTag,
  JumpArc,
  TerrainState,
  TERRAIN_KIND_TO_STATE,
} from "../components"
import type { SimCtx } from "../simulation"
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
  TICK_DT_SEC,
} from "../../../shared/balance-config"
import { terrainColliderSetForPlayerState } from "../../../shared/collision/arenaSpatialIndexes"
import { moveWithinWorldIndexed } from "../../../shared/collision/indexedWorldCollision"
import { worldCandidateGateForPlayerState } from "../../../shared/collision/worldCollidersForPlayer"

/** Pixels-per-second the knockback travels (budget drains at this rate). */
const KNOCKBACK_SPEED_PPS = 800
const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

/**
 * Applies a terrain-aware knockback step to player entities.
 *
 * @param world - ECS world containing the player entity.
 * @param eid - Player entity id.
 * @param stepX - Requested knockback x delta.
 * @param stepY - Requested knockback y delta.
 */
function applyPlayerKnockbackStep(
  world: SimCtx["world"],
  eid: number,
  stepX: number,
  stepY: number,
): void {
  const jumpZ = hasComponent(world, eid, JumpArc) ? JumpArc.z[eid] : 0
  const terrainState = TERRAIN_KIND_TO_STATE[TerrainState.kind[eid]] ?? "land"
  const candidateGate = worldCandidateGateForPlayerState(jumpZ, terrainState)
  const colliderSet = terrainColliderSetForPlayerState(jumpZ, terrainState, {
    jumpStartedInLava:
      hasComponent(world, eid, JumpArc) && JumpArc.startedInLava[eid] === 1,
  })
  const moved = moveWithinWorldIndexed(
    Position.x[eid],
    Position.y[eid],
    stepX,
    stepY,
    PLAYER_WORLD_COLLISION_FOOTPRINT,
    ARENA_BOUNDS,
    colliderSet,
    candidateGate,
  )
  Position.x[eid] = moved.x
  Position.y[eid] = moved.y
}

/**
 * Runs the knockback system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function knockbackSystem(ctx: SimCtx): void {
  const { world } = ctx

  const applyKnockback = (eid: number) => {
    if (!hasComponent(world, eid, Knockback)) return

    const ix = Knockback.impulseX[eid]
    const iy = Knockback.impulseY[eid]
    const remaining = Knockback.remainingPx[eid]

    if (remaining <= 0) {
      removeComponent(world, eid, Knockback)
      return
    }

    const len = Math.sqrt(ix * ix + iy * iy)
    if (len === 0) {
      removeComponent(world, eid, Knockback)
      return
    }

    const step = Math.min(remaining, KNOCKBACK_SPEED_PPS * TICK_DT_SEC)
    const stepX = (ix / len) * step
    const stepY = (iy / len) * step
    if (hasComponent(world, eid, PlayerTag)) {
      applyPlayerKnockbackStep(world, eid, stepX, stepY)
    } else {
      Position.x[eid] += stepX
      Position.y[eid] += stepY
    }
    Knockback.remainingPx[eid] -= step

    if (Knockback.remainingPx[eid] <= 0) {
      removeComponent(world, eid, Knockback)
    }
  }

  for (const eid of query(world, [PlayerTag, Knockback])) {
    applyKnockback(eid)
  }
  for (const eid of query(world, [FireballTag, Knockback])) {
    applyKnockback(eid)
  }
}
