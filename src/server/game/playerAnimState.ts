/**
 * Server-side helper: `PlayerAnimState` for a player entity, shared by
 * `playerDeltaSystem` and full `GameStateSync` snapshots.
 */
import { hasComponent, type World } from "bitecs"

import {
  Velocity,
  Casting,
  DeadTag,
  DyingTag,
  SwingingWeapon,
  ABILITY_INDEX_TO_ID,
} from "./components"
import type { PlayerAnimState } from "../../shared/types"

/**
 * Returns the current cast ability id when the entity has `Casting`, else `null`.
 *
 * @param world - bitECS world.
 * @param eid - Player entity id.
 */
export function getCastingAbilityId(world: World, eid: number): string | null {
  if (!hasComponent(world, eid, Casting)) return null
  return ABILITY_INDEX_TO_ID[Casting.abilityIndex[eid]] ?? null
}

/**
 * Returns the `PlayerAnimState` string for a player entity, matching
 * `playerDeltaSystem` semantics.
 *
 * @param world - bitECS world.
 * @param eid - Player entity id.
 * @returns Current animation state for networking.
 */
export function computePlayerAnimState(world: World, eid: number): PlayerAnimState {
  if (hasComponent(world, eid, DeadTag)) return "dead"
  if (hasComponent(world, eid, DyingTag)) return "dying"
  if (hasComponent(world, eid, SwingingWeapon)) return "axe_swing"

  if (hasComponent(world, eid, Casting)) {
    const abilityId = ABILITY_INDEX_TO_ID[Casting.abilityIndex[eid]] ?? ""
    if (abilityId === "lightning_bolt") return "heavy_cast"
    return "light_cast"
  }

  const vx = Velocity.vx[eid]
  const vy = Velocity.vy[eid]
  if (vx !== 0 || vy !== 0) return "walk"

  return "idle"
}
