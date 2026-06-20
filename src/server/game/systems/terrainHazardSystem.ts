import { addComponent, hasComponent, query } from "bitecs"

import {
  DeadTag,
  DyingTag,
  Health,
  JumpArc,
  PlayerTag,
  Position,
  SpectatorTag,
  TerrainState,
  Velocity,
  TERRAIN_KIND,
  NeedsWorldCollisionResolution,
} from "../components"
import type { SimCtx } from "../simulation"
import {
  CLIFF_SLIDE_SPEED_PX_PER_SEC,
  LAVA_DAMAGE_PER_SECOND,
  TICK_DT_SEC,
} from "../../../shared/balance-config"
import {
  nearestLavaCenter,
} from "../../../shared/collision/terrainHazards"
import { terrainStateAtPositionIndexed } from "../../../shared/collision/indexedWorldCollision"

export function terrainHazardSystem(ctx: SimCtx): void {
  const { world, damageRequests } = ctx

  for (const eid of query(world, [PlayerTag])) {
    if (
      hasComponent(world, eid, DyingTag) ||
      hasComponent(world, eid, DeadTag) ||
      hasComponent(world, eid, SpectatorTag)
    ) {
      TerrainState.kind[eid] = TERRAIN_KIND.land
      TerrainState.lavaDamageCarry[eid] = 0
      continue
    }

    if (hasComponent(world, eid, JumpArc)) {
      TerrainState.kind[eid] = TERRAIN_KIND.land
      TerrainState.lavaDamageCarry[eid] = 0
      continue
    }

    const sampled = terrainStateAtPositionIndexed(Position.x[eid], Position.y[eid])
    if (sampled === "lava") {
      TerrainState.kind[eid] = TERRAIN_KIND.lava
      const nextDamage = TerrainState.lavaDamageCarry[eid] + LAVA_DAMAGE_PER_SECOND * TICK_DT_SEC
      const wholeDamage = Math.floor(nextDamage)
      TerrainState.lavaDamageCarry[eid] = nextDamage - wholeDamage
      if (wholeDamage > 0 && Health.current[eid] > 0) {
        damageRequests.push({
          targetEid: eid,
          damage: wholeDamage,
          killerUserId: null,
          killerAbilityId: "lava",
        })
      }
      continue
    }

    TerrainState.lavaDamageCarry[eid] = 0
    if (sampled !== "cliff" && TerrainState.kind[eid] !== TERRAIN_KIND.cliff) {
      TerrainState.kind[eid] = TERRAIN_KIND.land
      continue
    }

    TerrainState.kind[eid] = TERRAIN_KIND.cliff
    const target = nearestLavaCenter(Position.x[eid], Position.y[eid])
    if (!target) continue

    const dx = target.x - Position.x[eid]
    const dy = target.y - Position.y[eid]
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist <= 0.001) continue

    const step = CLIFF_SLIDE_SPEED_PX_PER_SEC * TICK_DT_SEC
    const applied = Math.min(step, dist)
    const nx = (dx / dist) * applied
    const ny = (dy / dist) * applied
    Position.x[eid] += nx
    Position.y[eid] += ny
    addComponent(world, eid, NeedsWorldCollisionResolution)
    Velocity.vx[eid] = nx / TICK_DT_SEC
    Velocity.vy[eid] = ny / TICK_DT_SEC

    if (terrainStateAtPositionIndexed(Position.x[eid], Position.y[eid]) === "lava") {
      TerrainState.kind[eid] = TERRAIN_KIND.lava
    }
  }
}
