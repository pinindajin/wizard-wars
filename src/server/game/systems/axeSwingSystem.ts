/**
 * axeSwingSystem – handles the axe melee weapon lifecycle.
 *
 * On each tick:
 *  1. For players currently SwingingWeapon: remove the tag when
 *     the swing duration has expired (Cooldown.axe tick has passed).
 *  2. For eligible players (axe equipped, primary-fire input, cooldown ready,
 *     not already swinging, alive): start a swing, immediately check for hits
 *     in the arc, queue damage requests, emit AxeSwingPayload.
 *
 * Axe hit check: cone in front of caster, AXE_SWING_ARC_DEG wide,
 * AXE_SWING_RADIUS_PX deep.  The caster is always excluded from the target set.
 */
import { query, hasComponent, addComponent, removeComponent } from "bitecs"

import {
  Position,
  Facing,
  Equipment,
  Cooldown,
  PlayerInput,
  PlayerTag,
  SwingingWeapon,
  DyingTag,
  DeadTag,
  SpectatorTag,
  InvulnerableTag,
} from "../components"
import type { SimCtx, DamageRequest } from "../simulation"
import {
  AXE_DAMAGE,
  AXE_SWING_ARC_DEG,
  AXE_SWING_RADIUS_PX,
  AXE_SWING_DURATION_MS,
  TICK_MS,
} from "../../../shared/balance-config"

const HALF_ARC_RAD = ((AXE_SWING_ARC_DEG / 2) * Math.PI) / 180
const SWING_TICKS = Math.ceil(AXE_SWING_DURATION_MS / TICK_MS)

/** Returns true if point (px,py) is within the swing cone originating at (ox,oy). */
function inSwingCone(
  ox: number,
  oy: number,
  facingAngle: number,
  px: number,
  py: number,
): boolean {
  const dx = px - ox
  const dy = py - oy
  const distSq = dx * dx + dy * dy
  if (distSq > AXE_SWING_RADIUS_PX * AXE_SWING_RADIUS_PX) return false
  const angle = Math.atan2(dy, dx)
  let diff = angle - facingAngle
  // Normalise to [-π, π]
  while (diff > Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI
  return Math.abs(diff) <= HALF_ARC_RAD
}

/**
 * Runs the axe swing system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function axeSwingSystem(ctx: SimCtx): void {
  const { world, currentTick, entityPlayerMap, axeSwings, damageRequests } = ctx

  // ── 1. Clear expired swings ──────────────────────────────────────────
  for (const eid of query(world, [PlayerTag, SwingingWeapon])) {
    if (currentTick >= Cooldown.axe[eid]) {
      removeComponent(world, eid, SwingingWeapon)
    }
  }

  // ── 2. Start new swings ──────────────────────────────────────────────
  for (const eid of query(world, [PlayerTag])) {
    if (Equipment.hasAxe[eid] !== 1) continue
    if (PlayerInput.weaponPrimary[eid] !== 1) continue
    if (hasComponent(world, eid, SwingingWeapon)) continue
    if (currentTick < Cooldown.axe[eid]) continue
    if (hasComponent(world, eid, DyingTag)) continue
    if (hasComponent(world, eid, DeadTag)) continue
    if (hasComponent(world, eid, SpectatorTag)) continue

    // Start swing
    addComponent(world, eid, SwingingWeapon)
    Cooldown.axe[eid] = currentTick + SWING_TICKS

    const cx = Position.x[eid]
    const cy = Position.y[eid]
    const facing = Facing.angle[eid]
    const casterUserId = entityPlayerMap.get(eid) ?? ""

    // Check for hits against all other living players
    const hitPlayerIds: string[] = []
    for (const target of query(world, [PlayerTag])) {
      if (target === eid) continue // caster excluded
      if (hasComponent(world, target, DyingTag)) continue
      if (hasComponent(world, target, DeadTag)) continue
      if (hasComponent(world, target, SpectatorTag)) continue
      if (hasComponent(world, target, InvulnerableTag)) continue

      if (!inSwingCone(cx, cy, facing, Position.x[target], Position.y[target])) continue

      const targetUserId = entityPlayerMap.get(target)
      if (targetUserId) hitPlayerIds.push(targetUserId)

      const req: DamageRequest = {
        targetEid: target,
        damage: AXE_DAMAGE,
        killerUserId: casterUserId,
        killerAbilityId: "axe",
      }
      damageRequests.push(req)
    }

    axeSwings.push({
      casterId: casterUserId,
      x: cx,
      y: cy,
      facingAngle: facing,
      hitPlayerIds,
      damage: AXE_DAMAGE,
    })
  }
}
