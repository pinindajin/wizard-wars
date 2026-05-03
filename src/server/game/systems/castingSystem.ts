/**
 * castingSystem – manages the full lifecycle of castable abilities.
 *
 * On each tick:
 *  1. Advances active casts:
 *     - Fireball: enqueues a projectile via the command buffer; spawn position is read at
 *       buffer execute time (after movement) using press-locked aim from cast start.
 *     - Lightning Bolt: queues a PendingLightningBolt for lightningBoltSystem.
 *     - Healing Potion: heals the caster immediately.
 *     - Effects fire at configured ms timing; cooldown starts when animation ends.
 *  2. Starts new casts from PlayerInput.abilitySlot.
 *  3. Processes quick-item (healing potion) usage from PlayerInput.useQuickItemSlot.
 */
import { query, hasComponent, addComponent, removeComponent, type World } from "bitecs"

import {
  PlayerTag,
  PlayerInput,
  Casting,
  Cooldown,
  AbilitySlots,
  QuickItemSlots,
  Health,
  Position,
  Velocity,
  Facing,
  Hero,
  Ownership,
  ProjectileTag,
  FireballTag,
  DyingTag,
  DeadTag,
  SpectatorTag,
  ABILITY_INDEX_TO_ID,
  ITEM_INDEX_TO_ID,
  HERO_INDEX_TO_ID,
  JumpArc,
  SwingingWeapon,
  Knockback,
  TerrainState,
  TERRAIN_KIND,
} from "../components"
import type { SimCtx, PendingLightningBolt } from "../simulation"
import {
  FIREBALL_SPEED_PX_PER_SEC,
  FIREBALL_COOLDOWN_MS,
  LIGHTNING_COOLDOWN_MS,
  LIGHTNING_BOLT_ARC_PX,
  LIGHTNING_HIT_RADIUS_PX,
  HEALING_POTION_CAST_MS,
  HEALING_POTION_HP,
  DEFAULT_PLAYER_HEALTH,
  TICK_MS,
  LIGHTNING_TELEGRAPH_DANGER_LEAD_MS,
  JUMP_COOLDOWN_MS,
  JUMP_INITIAL_VZ_PX_PER_SEC,
  JUMP_AIRBORNE_COLLIDER_EPSILON_PX,
} from "../../../shared/balance-config"
import { ABILITY_CONFIGS } from "../../../shared/balance-config/abilities"
import {
  getSpellAnimationConfig,
  msToTickOffset,
} from "../../../shared/balance-config/animationConfig"
import {
  combatTelegraphId,
  endCombatTelegraph,
  startCombatTelegraph,
} from "../combatTelegraphs"

/** Returns true when quick items and new melee swings must be blocked (airborne). */
function isAirborneForAirLock(world: World, eid: number): boolean {
  if (!hasComponent(world, eid, JumpArc)) return false
  return JumpArc.z[eid] > JUMP_AIRBORNE_COLLIDER_EPSILON_PX
}

/** Tick duration equivalent for each ability cooldown. */
const COOLDOWN_TICKS: Record<string, number> = {
  fireball: Math.ceil(FIREBALL_COOLDOWN_MS / TICK_MS),
  lightning_bolt: Math.ceil(LIGHTNING_COOLDOWN_MS / TICK_MS),
  healing_potion: Math.ceil(HEALING_POTION_CAST_MS / TICK_MS),
  jump: Math.ceil(JUMP_COOLDOWN_MS / TICK_MS),
}

/** Returns the hero id stored on an entity, falling back to the default index. */
function heroIdForCaster(eid: number): string {
  return HERO_INDEX_TO_ID[Hero.typeIndex[eid]] ?? HERO_INDEX_TO_ID[0]!
}

/** Returns configured animation/effect ticks for a spell cast. */
function spellCastTicks(heroId: string, abilityId: string): {
  animationTicks: number
  effectTicks: number
} {
  const cfg = getSpellAnimationConfig(heroId, abilityId)
  const animationTicks = msToTickOffset(cfg.durationMs)
  const effectTicks =
    cfg.effectTiming === "before"
      ? 0
      : cfg.effectTiming === "after"
      ? animationTicks
      : msToTickOffset(cfg.effectAtMs ?? cfg.durationMs)
  return { animationTicks, effectTicks }
}

/** Returns the AbilitySlots slot value for a given slot index. */
function slotAbilityIndex(eid: number, slot: number): number {
  switch (slot) {
    case 0: return AbilitySlots.slot0[eid]
    case 1: return AbilitySlots.slot1[eid]
    case 2: return AbilitySlots.slot2[eid]
    case 3: return AbilitySlots.slot3[eid]
    case 4: return AbilitySlots.slot4[eid]
    default: return -1
  }
}

/** Checks if an ability cooldown is ready for the given entity. */
function isCooldownReady(eid: number, abilityId: string, currentTick: number): boolean {
  switch (abilityId) {
    case "fireball":       return currentTick >= Cooldown.fireball[eid]
    case "lightning_bolt": return currentTick >= Cooldown.lightningBolt[eid]
    case "healing_potion": return currentTick >= Cooldown.healingPotion[eid]
    case "jump":           return currentTick >= Cooldown.jump[eid]
    default:               return false
  }
}

/** Sets the cooldown for an ability. */
function setCooldown(eid: number, abilityId: string, currentTick: number): void {
  const cd = COOLDOWN_TICKS[abilityId] ?? 0
  switch (abilityId) {
    case "fireball":       Cooldown.fireball[eid]       = currentTick + cd; break
    case "lightning_bolt": Cooldown.lightningBolt[eid] = currentTick + cd; break
    case "healing_potion": Cooldown.healingPotion[eid] = currentTick + cd; break
    case "jump":           Cooldown.jump[eid]          = currentTick + cd; break
  }
}

// ─── Cast completion handlers ────────────────────────────────────────────

/**
 * Returns true when a deferred fireball must not spawn for this caster at buffer execute time.
 *
 * @param world - bitECS world.
 * @param casterEid - Player entity that queued the cast.
 * @returns True if spawn should be skipped (dying, dead, or spectator).
 */
function shouldSkipDeferredFireballSpawn(world: World, casterEid: number): boolean {
  return (
    hasComponent(world, casterEid, DyingTag) ||
    hasComponent(world, casterEid, DeadTag) ||
    hasComponent(world, casterEid, SpectatorTag)
  )
}

/**
 * Enqueues creation of a fireball projectile at end-of-tick execute.
 *
 * Spawn position uses the caster's {@link Position} inside `setup` (after `movementSystem`
 * for this tick). Travel direction uses `capturedAngle` from press-time aim. If the caster
 * is dying, dead, or spectator at execute time, the enqueue is a no-op.
 *
 * @param ctx - Simulation context.
 * @param casterEid - Casting player entity id.
 * @param capturedAngle - Locked world radians from cast start (cursor vs feet at press).
 */
function launchFireball(ctx: SimCtx, casterEid: number, capturedAngle: number): void {
  const {
    world,
    commandBuffer,
    currentTick,
    fireballOwnerMap,
    fireballCreatedAtTickMap,
    entityPlayerMap,
    fireballLaunches,
  } = ctx

  const angle = capturedAngle
  const vx = Math.cos(angle) * FIREBALL_SPEED_PX_PER_SEC
  const vy = Math.sin(angle) * FIREBALL_SPEED_PX_PER_SEC
  const casterUserId = entityPlayerMap.get(casterEid) ?? ""

  commandBuffer.enqueue({
    type: "addEntity",
    skipIf: (w) => shouldSkipDeferredFireballSpawn(w, casterEid),
    setup: (fbEid) => {
      const cx = Position.x[casterEid]
      const cy = Position.y[casterEid]
      // Spawn slightly in front of caster to avoid self-collision on tick 0
      const spawnX = cx + Math.cos(angle) * 25
      const spawnY = cy + Math.sin(angle) * 25

      addComponent(world, fbEid, FireballTag)
      addComponent(world, fbEid, ProjectileTag)
      addComponent(world, fbEid, Position)
      addComponent(world, fbEid, Velocity)
      addComponent(world, fbEid, Ownership)
      Position.x[fbEid] = spawnX
      Position.y[fbEid] = spawnY
      Velocity.vx[fbEid] = vx
      Velocity.vy[fbEid] = vy
      Ownership.ownerEid[fbEid] = casterEid
      fireballOwnerMap.set(fbEid, casterUserId)
      fireballCreatedAtTickMap.set(fbEid, currentTick)

      fireballLaunches.push({
        id: fbEid,
        ownerId: casterUserId,
        x: spawnX,
        y: spawnY,
        vx,
        vy,
      })
    },
  })
}

/** Queues a pending lightning bolt for lightningBoltSystem. */
function queueLightningBolt(
  ctx: SimCtx,
  casterEid: number,
  directionRad: number,
): void {
  const casterUserId = ctx.entityPlayerMap.get(casterEid) ?? ""

  const pending: PendingLightningBolt = {
    casterEid,
    casterUserId,
    directionRad,
  }
  ctx.pendingLightningBolts.push(pending)
}

/**
 * Starts the client-rendered Lightning Bolt capsule telegraph.
 *
 * @param ctx - Simulation context.
 * @param eid - Caster entity id.
 * @param casterUserId - Caster user id.
 * @param directionRad - Locked world-space lightning direction.
 */
function startLightningTelegraph(
  ctx: SimCtx,
  eid: number,
  casterUserId: string,
  directionRad: number,
): void {
  const effectAtServerTimeMs =
    ctx.serverTimeMs + (Casting.effectFiresAtTick[eid] - ctx.currentTick) * TICK_MS
  const id = combatTelegraphId("spell", casterUserId, "lightning_bolt", Casting.startedAtTick[eid])
  startCombatTelegraph(ctx, {
    id,
    casterId: casterUserId,
    sourceId: "lightning_bolt",
    anchor: "caster",
    directionRad,
    shape: {
      type: "capsule",
      lengthPx: LIGHTNING_BOLT_ARC_PX,
      radiusPx: LIGHTNING_HIT_RADIUS_PX,
    },
    startsAtServerTimeMs: ctx.serverTimeMs,
    dangerStartsAtServerTimeMs: Math.max(
      ctx.serverTimeMs,
      effectAtServerTimeMs - LIGHTNING_TELEGRAPH_DANGER_LEAD_MS,
    ),
    dangerEndsAtServerTimeMs: effectAtServerTimeMs,
    endsAtServerTimeMs: effectAtServerTimeMs,
  })
}

/**
 * Ends the active lightning telegraph for a caster if one exists.
 *
 * @param ctx - Simulation context.
 * @param eid - Caster entity id.
 * @param reason - Client-visible removal reason.
 */
function endLightningTelegraphForCaster(
  ctx: SimCtx,
  eid: number,
  reason: Parameters<typeof endCombatTelegraph>[2],
): void {
  const casterUserId = ctx.entityPlayerMap.get(eid) ?? ""
  const id = combatTelegraphId("spell", casterUserId, "lightning_bolt", Casting.startedAtTick[eid])
  endCombatTelegraph(ctx, id, reason)
}

/** Applies healing-potion HP restoration to the caster. */
function applyHealingPotion(ctx: SimCtx, eid: number): void {
  const newHp = Math.min(
    Health.current[eid] + HEALING_POTION_HP,
    Health.max[eid] !== 0 ? Health.max[eid] : DEFAULT_PLAYER_HEALTH,
  )
  Health.current[eid] = newHp
}

// ─── System entry point ──────────────────────────────────────────────────

/**
 * Runs the casting system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function castingSystem(ctx: SimCtx): void {
  const { world, currentTick } = ctx

  // ── 1. Complete active casts ─────────────────────────────────────────
  for (const eid of query(world, [PlayerTag, Casting])) {
    if (
      hasComponent(world, eid, DyingTag) ||
      hasComponent(world, eid, DeadTag) ||
      hasComponent(world, eid, SpectatorTag)
    ) {
      const abilityId = ABILITY_INDEX_TO_ID[Casting.abilityIndex[eid]] ?? ""
      if (abilityId === "lightning_bolt") {
        endLightningTelegraphForCaster(
          ctx,
          eid,
          hasComponent(world, eid, SpectatorTag) ? "spectator" : "caster_dead",
        )
      }
      removeComponent(world, eid, Casting)
      continue
    }

    const abilityIndex = Casting.abilityIndex[eid]
    const abilityId = ABILITY_INDEX_TO_ID[abilityIndex] ?? ""

    if (Casting.effectFired[eid] !== 1 && currentTick >= Casting.effectFiresAtTick[eid]) {
      switch (abilityId) {
        case "fireball":
          launchFireball(ctx, eid, Casting.capturedFacingAngle[eid])
          break
        case "lightning_bolt":
          queueLightningBolt(
            ctx,
            eid,
            Casting.capturedFacingAngle[eid],
          )
          endLightningTelegraphForCaster(ctx, eid, "expired")
          break
        case "healing_potion":
          applyHealingPotion(ctx, eid)
          break
      }
      Casting.effectFired[eid] = 1
    }

    if (currentTick >= Casting.animationEndsAtTick[eid]) {
      setCooldown(eid, abilityId, currentTick)
      removeComponent(world, eid, Casting)
    }
  }

  // ── 2. Start new ability-bar casts ───────────────────────────────────
  for (const eid of query(world, [PlayerTag])) {
    if (hasComponent(world, eid, DyingTag)) continue
    if (hasComponent(world, eid, DeadTag)) continue
    if (hasComponent(world, eid, SpectatorTag)) continue
    if (hasComponent(world, eid, Casting)) continue

    const slot = PlayerInput.abilitySlot[eid]
    if (slot < 0) continue

    const abilityIndex = slotAbilityIndex(eid, slot)
    if (abilityIndex < 0) continue

    const abilityId = ABILITY_INDEX_TO_ID[abilityIndex] ?? ""
    if (!abilityId) continue

    if (isAirborneForAirLock(world, eid)) continue

    if (abilityId === "jump") {
      const jumpCfg = ABILITY_CONFIGS.jump
      if (!jumpCfg) continue
      if (hasComponent(world, eid, SwingingWeapon)) continue
      if (hasComponent(world, eid, Knockback)) continue
      if (!isCooldownReady(eid, "jump", currentTick)) continue

      const jumpStartedInLava = TerrainState.kind[eid] === TERRAIN_KIND.lava ? 1 : 0
      addComponent(world, eid, JumpArc)
      JumpArc.z[eid] = JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1
      JumpArc.vz[eid] = JUMP_INITIAL_VZ_PX_PER_SEC
      JumpArc.startedInLava[eid] = jumpStartedInLava
      TerrainState.kind[eid] = TERRAIN_KIND.land
      TerrainState.lavaDamageCarry[eid] = 0
      setCooldown(eid, "jump", currentTick)
      ctx.abilitySfxEvents.push({ sfxKey: jumpCfg.castSfxKey })
      continue
    }

    const cfg = ABILITY_CONFIGS[abilityId]
    if (!cfg) continue

    if (!isCooldownReady(eid, abilityId, currentTick)) continue

    const heroId = heroIdForCaster(eid)
    const timing = spellCastTicks(heroId, abilityId)

    addComponent(world, eid, Casting)
    Casting.abilityIndex[eid] = abilityIndex
    Casting.startedAtTick[eid] = currentTick
    Casting.animationEndsAtTick[eid] = currentTick + timing.animationTicks
    Casting.effectFiresAtTick[eid] = currentTick + timing.effectTicks
    Casting.effectFired[eid] = 0
    Casting.quick[eid] = cfg.quick ? 1 : 0
    Casting.capturedPositionX[eid] = Position.x[eid]
    Casting.capturedPositionY[eid] = Position.y[eid]
    Casting.capturedTargetX[eid] = PlayerInput.abilityTargetX[eid]
    Casting.capturedTargetY[eid] = PlayerInput.abilityTargetY[eid]
    const targetDx = Casting.capturedTargetX[eid] - Casting.capturedPositionX[eid]
    const targetDy = Casting.capturedTargetY[eid] - Casting.capturedPositionY[eid]
    Casting.capturedFacingAngle[eid] =
      targetDx !== 0 || targetDy !== 0 ? Math.atan2(targetDy, targetDx) : Facing.angle[eid]
    Facing.angle[eid] = Casting.capturedFacingAngle[eid]

    if (abilityId === "lightning_bolt") {
      const casterUserId = ctx.entityPlayerMap.get(eid) ?? ""
      startLightningTelegraph(ctx, eid, casterUserId, Casting.capturedFacingAngle[eid])
    }
  }

  // ── 3. Quick-item usage (healing potion etc.) ────────────────────────
  for (const eid of query(world, [PlayerTag])) {
    if (hasComponent(world, eid, DyingTag)) continue
    if (hasComponent(world, eid, DeadTag)) continue
    if (hasComponent(world, eid, SpectatorTag)) continue

    const qSlot = PlayerInput.useQuickItemSlot[eid]
    if (qSlot < 0) continue

    if (isAirborneForAirLock(world, eid)) continue

    let itemIndex = -1
    let charges = 0
    switch (qSlot) {
      case 0: itemIndex = QuickItemSlots.slot0Item[eid]; charges = QuickItemSlots.slot0Charges[eid]; break
      case 1: itemIndex = QuickItemSlots.slot1Item[eid]; charges = QuickItemSlots.slot1Charges[eid]; break
      case 2: itemIndex = QuickItemSlots.slot2Item[eid]; charges = QuickItemSlots.slot2Charges[eid]; break
      case 3: itemIndex = QuickItemSlots.slot3Item[eid]; charges = QuickItemSlots.slot3Charges[eid]; break
    }

    if (itemIndex < 0 || charges <= 0) continue

    const itemId = ITEM_INDEX_TO_ID[itemIndex] ?? ""
    if (itemId === "healing_potion") {
      if (!isCooldownReady(eid, "healing_potion", currentTick)) continue
      applyHealingPotion(ctx, eid)
      setCooldown(eid, "healing_potion", currentTick)
      // Consume one charge
      switch (qSlot) {
        case 0: QuickItemSlots.slot0Charges[eid]--; break
        case 1: QuickItemSlots.slot1Charges[eid]--; break
        case 2: QuickItemSlots.slot2Charges[eid]--; break
        case 3: QuickItemSlots.slot3Charges[eid]--; break
      }
    }
  }
}
