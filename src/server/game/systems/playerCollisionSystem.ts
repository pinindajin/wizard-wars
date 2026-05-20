/**
 * playerCollisionSystem – resolves circle-vs-circle overlaps between player
 * entities by pushing both apart along the collision normal.
 *
 * Only live (non-dying, non-dead, non-spectator) players participate.
 */
import { query, hasComponent } from "bitecs"

import {
  Position,
  PlayerTag,
  DyingTag,
  DeadTag,
  SpectatorTag,
  JumpArc,
  TerrainState,
  TERRAIN_KIND_TO_STATE,
} from "../components"
import type { SimCtx } from "../simulation"
import { PLAYER_RADIUS_PX } from "../../../shared/balance-config"
import { worldCandidateGateForPlayerState } from "../../../shared/collision/worldCollidersForPlayer"

const DIAMETER = PLAYER_RADIUS_PX * 2

/**
 * Returns whether a player collision displacement may keep its new position.
 *
 * @param world - ECS world containing the player entity.
 * @param eid - Player entity id.
 */
function canKeepCollisionDisplacement(world: SimCtx["world"], eid: number): boolean {
  const jumpZ = hasComponent(world, eid, JumpArc) ? JumpArc.z[eid] : 0
  const terrainState = TERRAIN_KIND_TO_STATE[TerrainState.kind[eid]] ?? "land"
  const candidateGate = worldCandidateGateForPlayerState(jumpZ, terrainState)
  return candidateGate?.(Position.x[eid], Position.y[eid]) ?? true
}

/**
 * Runs the player collision system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function playerCollisionSystem(ctx: SimCtx): void {
  const { world } = ctx

  const players: number[] = []
  for (const eid of query(world, [PlayerTag])) {
    if (hasComponent(world, eid, DyingTag)) continue
    if (hasComponent(world, eid, DeadTag)) continue
    if (hasComponent(world, eid, SpectatorTag)) continue
    players.push(eid)
  }

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]
      const b = players[j]

      const dx = Position.x[b] - Position.x[a]
      const dy = Position.y[b] - Position.y[a]
      const distSq = dx * dx + dy * dy
      const minDist = DIAMETER

      if (distSq >= minDist * minDist) continue

      const dist = Math.sqrt(distSq) || 0.001
      const overlap = minDist - dist
      const nx = dx / dist
      const ny = dy / dist
      const half = overlap / 2
      const ax = Position.x[a]
      const ay = Position.y[a]
      const bx = Position.x[b]
      const by = Position.y[b]

      Position.x[a] -= nx * half
      Position.y[a] -= ny * half
      Position.x[b] += nx * half
      Position.y[b] += ny * half

      if (!canKeepCollisionDisplacement(world, a)) {
        Position.x[a] = ax
        Position.y[a] = ay
      }
      if (!canKeepCollisionDisplacement(world, b)) {
        Position.x[b] = bx
        Position.y[b] = by
      }
    }
  }
}
