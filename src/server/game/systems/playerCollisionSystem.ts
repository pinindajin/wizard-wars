/**
 * playerCollisionSystem – resolves circle-vs-circle overlaps between player
 * entities by pushing both apart along the collision normal.
 *
 * Only live (non-dying, non-dead, non-spectator) players participate.
 */
import { query, hasComponent } from "bitecs"

import { Position, Radius, PlayerTag, DyingTag, DeadTag, SpectatorTag } from "../components"
import type { SimCtx } from "../simulation"
import { PLAYER_RADIUS_PX } from "../../../shared/balance-config"

const DIAMETER = PLAYER_RADIUS_PX * 2

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

      Position.x[a] -= nx * half
      Position.y[a] -= ny * half
      Position.x[b] += nx * half
      Position.y[b] += ny * half
    }
  }
}
