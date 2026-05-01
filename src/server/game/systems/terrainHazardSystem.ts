import { hasComponent, query } from "bitecs"

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
} from "../components"
import type { SimCtx } from "../simulation"
import {
  CLIFF_SLIDE_SPEED_PX_PER_SEC,
  LAVA_DAMAGE_PER_SECOND,
  TICK_DT_SEC,
} from "../../../shared/balance-config"
import {
  nearestLavaCenter,
  terrainStateAtPosition,
} from "../../../shared/collision/terrainHazards"

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

    const sampled = terrainStateAtPosition(Position.x[eid], Position.y[eid])
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
      return
    }

    TerrainState.lavaDamageCarry[eid] = 0
    if (sampled !== "cliff" && TerrainState.kind[eid] !== TERRAIN_KIND.cliff) {
      TerrainState.kind[eid] = TERRAIN_KIND.land
      return
    }

    TerrainState.kind[eid] = TERRAIN_KIND.cliff
    const target = nearestLavaCenter(Position.x[eid], Position.y[eid])
    if (!target) return

    const dx = target.x - Position.x[eid]
    const dy = target.y - Position.y[eid]
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist <= 0.001) return

    const step = CLIFF_SLIDE_SPEED_PX_PER_SEC * TICK_DT_SEC
    const applied = Math.min(step, dist)
    const nx = (dx / dist) * applied
    const ny = (dy / dist) * applied
    Position.x[eid] += nx
    Position.y[eid] += ny
    Velocity.vx[eid] = nx / TICK_DT_SEC
    Velocity.vy[eid] = ny / TICK_DT_SEC

    if (terrainStateAtPosition(Position.x[eid], Position.y[eid]) === "lava") {
      TerrainState.kind[eid] = TERRAIN_KIND.lava
    }
  }
}
