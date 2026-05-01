/**
 * Server-side helper: derives the coarse `PlayerMoveState` used in
 * authoritative snapshots. Kept alongside `playerAnimState` so the pair is
 * updated together when new movement-affecting tags/components are added.
 */
import { hasComponent, type World } from "bitecs"

import {
  Velocity,
  Casting,
  DeadTag,
  DyingTag,
  SpectatorTag,
  SwingingWeapon,
  Knockback,
} from "./components"
import type { PlayerMoveState } from "../../shared/types"
import { ABILITY_INDEX_TO_ID } from "./components"
import { ABILITY_CONFIGS } from "../../shared/balance-config/abilities"

/**
 * Returns the `PlayerMoveState` string for a player entity.
 *
 * @param world - bitECS world.
 * @param eid - Player entity id.
 * @returns Coarse movement state for client routing decisions.
 */
export function computePlayerMoveState(world: World, eid: number): PlayerMoveState {
  if (hasComponent(world, eid, DeadTag)) return "idle"
  if (hasComponent(world, eid, DyingTag)) return "idle"
  if (hasComponent(world, eid, SpectatorTag)) return "idle"
  if (hasComponent(world, eid, Knockback)) return "knockback"

  if (hasComponent(world, eid, Casting)) {
    const abilityId = ABILITY_INDEX_TO_ID[Casting.abilityIndex[eid]] ?? ""
    const cfg = abilityId ? ABILITY_CONFIGS[abilityId] : undefined
    const castMoveMult = cfg?.castMoveSpeedMultiplier ?? 0
    return castMoveMult === 0 ? "rooted" : "casting"
  }

  if (hasComponent(world, eid, SwingingWeapon)) return "swinging"

  const vx = Velocity.vx[eid]
  const vy = Velocity.vy[eid]
  if (vx !== 0 || vy !== 0) return "moving"
  return "idle"
}
