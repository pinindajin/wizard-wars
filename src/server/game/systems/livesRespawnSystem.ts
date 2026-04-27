/**
 * livesRespawnSystem – manages the lives pool and respawn cycle for players
 * that have just transitioned to DeadTag this tick.
 *
 * On each newly-dead entity:
 *  1. Decrement Lives.count.
 *  2a. Lives > 0: pick farthest-free spawn point from alive enemies, schedule
 *      a RespawnTimer.  When the timer fires (checked same tick for
 *      pre-scheduled timers from previous ticks), restore health, add
 *      InvulnerableTag, face center, remove DeadTag.
 *  2b. Lives = 0: add SpectatorTag (triggers matchEndSystem).
 *
 * Spawn-point selection: pick the point with maximum minimum-distance to any
 * alive enemy player.  Ties resolved by lowest index.
 */
import { query, hasComponent, addComponent, removeComponent } from "bitecs"

import {
  Position,
  Facing,
  MoveFacing,
  Health,
  Lives,
  Cooldown,
  Casting,
  Knockback,
  RespawnTimer,
  PlayerTag,
  DeadTag,
  SpectatorTag,
  DyingTag,
  InvulnerableTag,
  DamageFlashTag,
  SwingingWeapon,
} from "../components"
import type { SimCtx } from "../simulation"
import {
  ARENA_SPAWN_POINTS,
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  DEFAULT_PLAYER_HEALTH,
  RESPAWN_DELAY_MS,
  DEATH_ANIM_MS,
  INVULNERABLE_WINDOW_MS,
  TICK_MS,
} from "../../../shared/balance-config"

const INVULNERABLE_TICKS = Math.ceil(INVULNERABLE_WINDOW_MS / TICK_MS)
const POST_DEATH_DELAY_MS = RESPAWN_DELAY_MS - DEATH_ANIM_MS

/**
 * Picks the spawn point that is farthest from all alive enemy players.
 * Falls back to index 0 when no alive enemies exist.
 */
function chooseFarthestSpawn(
  world: import("bitecs").World,
  excludeEid: number,
): { x: number; y: number; index: number } {
  // Collect alive enemy positions
  const alivePts: Array<{ x: number; y: number }> = []
  for (const eid of query(world, [PlayerTag])) {
    if (eid === excludeEid) continue
    if (hasComponent(world, eid, DeadTag)) continue
    if (hasComponent(world, eid, SpectatorTag)) continue
    if (hasComponent(world, eid, DyingTag)) continue
    alivePts.push({ x: Position.x[eid], y: Position.y[eid] })
  }

  if (alivePts.length === 0) {
    return { ...ARENA_SPAWN_POINTS[0], index: 0 }
  }

  let bestIndex = 0
  let bestMinDist = -1

  for (let i = 0; i < ARENA_SPAWN_POINTS.length; i++) {
    const sp = ARENA_SPAWN_POINTS[i]
    let minDist = Infinity
    for (const pt of alivePts) {
      const dx = sp.x - pt.x
      const dy = sp.y - pt.y
      const d = dx * dx + dy * dy
      if (d < minDist) minDist = d
    }
    if (minDist > bestMinDist) {
      bestMinDist = minDist
      bestIndex = i
    }
  }

  return { ...ARENA_SPAWN_POINTS[bestIndex], index: bestIndex }
}

/**
 * Resets a player entity to a fully-alive state at the given spawn point.
 */
function respawnPlayer(
  ctx: SimCtx,
  eid: number,
  spawnX: number,
  spawnY: number,
  facingAngle: number,
): void {
  const { world, currentTick, serverTimeMs, entityPlayerMap, playerRespawns } = ctx

  Position.x[eid] = spawnX
  Position.y[eid] = spawnY
  Facing.angle[eid] = facingAngle
  MoveFacing.angle[eid] = facingAngle
  Health.current[eid] = Health.max[eid] > 0 ? Health.max[eid] : DEFAULT_PLAYER_HEALTH

  // Clear transient combat state
  if (hasComponent(world, eid, Knockback)) removeComponent(world, eid, Knockback)
  if (hasComponent(world, eid, Casting))  removeComponent(world, eid, Casting)
  if (hasComponent(world, eid, SwingingWeapon)) removeComponent(world, eid, SwingingWeapon)
  if (hasComponent(world, eid, DamageFlashTag)) removeComponent(world, eid, DamageFlashTag)

  removeComponent(world, eid, DeadTag)
  addComponent(world, eid, InvulnerableTag)
  Cooldown.fireball[eid]    = 0
  Cooldown.lightningBolt[eid] = 0
  Cooldown.primaryMelee[eid] = 0
  Cooldown.healingPotion[eid] = 0

  // Invulnerability expiry stored in ticks
  // We store it on a side field; InvulnerableTag is just a presence marker.
  // Use Cooldown as proxy: track invuln via a dedicated expiry check.
  // Since there's no dedicated numeric field on InvulnerableTag, we track
  // expiry in the simulation ctx's prevPlayerStates or via a tick comparison.
  // For simplicity, use a module-level WeakMap-like side map via ctx.
  // NOTE: InvulnerableTag is removed by invulnerabilityCleanup (below).
  setInvulnExpiry(eid, currentTick + INVULNERABLE_TICKS)

  const userId = entityPlayerMap.get(eid) ?? ""
  playerRespawns.push({
    playerId: userId,
    spawnX,
    spawnY,
    facingAngle,
  })
}

// ── Invulnerability expiry side-storage ──────────────────────────────────
// Cannot store per-entity tick on InvulnerableTag (pure tag, no fields).
// Use a module-level Map (eid → expiresAtTick).
const invulnExpiry = new Map<number, number>()

function setInvulnExpiry(eid: number, tick: number): void {
  invulnExpiry.set(eid, tick)
}

/**
 * Runs the lives-respawn system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function livesRespawnSystem(ctx: SimCtx): void {
  const { world, currentTick, serverTimeMs, entityPlayerMap, playerDeaths } = ctx

  // ── 1. Remove expired invulnerability ────────────────────────────────
  for (const [eid, expiresAt] of invulnExpiry) {
    if (currentTick >= expiresAt && hasComponent(world, eid, InvulnerableTag)) {
      removeComponent(world, eid, InvulnerableTag)
      invulnExpiry.delete(eid)
    }
  }

  // ── 2. Fire pending respawn timers ────────────────────────────────────
  for (const eid of query(world, [PlayerTag, DeadTag, RespawnTimer])) {
    if (serverTimeMs < RespawnTimer.fireAtMs[eid]) continue

    const spawnX = RespawnTimer.spawnX[eid]
    const spawnY = RespawnTimer.spawnY[eid]
    const facing = RespawnTimer.facingAngle[eid]
    removeComponent(world, eid, RespawnTimer)
    respawnPlayer(ctx, eid, spawnX, spawnY, facing)
  }

  // ── 3. Process newly-dead entities (just transitioned to DeadTag) ────
  // We detect "newly dead" by checking: DeadTag present AND no RespawnTimer
  // AND no SpectatorTag (not yet processed).
  for (const eid of query(world, [PlayerTag, DeadTag])) {
    if (hasComponent(world, eid, RespawnTimer)) continue
    if (hasComponent(world, eid, SpectatorTag)) continue

    // Decrement lives
    if (Lives.count[eid] > 0) {
      Lives.count[eid]--
    }

    const userId = entityPlayerMap.get(eid) ?? ""

    if (Lives.count[eid] > 0) {
      // Schedule respawn
      const spawn = chooseFarthestSpawn(world, eid)
      const dx = ARENA_CENTER_X - spawn.x
      const dy = ARENA_CENTER_Y - spawn.y
      const facingAngle = Math.atan2(dy, dx)

      addComponent(world, eid, RespawnTimer)
      RespawnTimer.fireAtMs[eid] = serverTimeMs + POST_DEATH_DELAY_MS
      RespawnTimer.spawnX[eid] = spawn.x
      RespawnTimer.spawnY[eid] = spawn.y
      RespawnTimer.facingAngle[eid] = facingAngle

      // Emit death payload (killerInfo comes from deathEvents queued by healthSystem)
      const deathEvent = ctx.deathEvents.find((e) => e.playerEid === eid)
      const killerUid = deathEvent?.killerUserId ?? null
      playerDeaths.push({
        playerId: userId,
        killerPlayerId: killerUid,
        killerAbilityId: deathEvent?.killerAbilityId ?? null,
        livesRemaining: Lives.count[eid],
        x: Position.x[eid],
        y: Position.y[eid],
        victimUsername: ctx.entityUsernameMap.get(eid) ?? "",
        ...(killerUid != null
          ? { killerUsername: ctx.playerUsernameMap.get(killerUid) ?? "" }
          : {}),
      })
    } else {
      // No lives left → spectator
      addComponent(world, eid, SpectatorTag)

      const deathEvent = ctx.deathEvents.find((e) => e.playerEid === eid)
      const killerUid = deathEvent?.killerUserId ?? null
      playerDeaths.push({
        playerId: userId,
        killerPlayerId: killerUid,
        killerAbilityId: deathEvent?.killerAbilityId ?? null,
        livesRemaining: 0,
        x: Position.x[eid],
        y: Position.y[eid],
        victimUsername: ctx.entityUsernameMap.get(eid) ?? "",
        ...(killerUid != null
          ? { killerUsername: ctx.playerUsernameMap.get(killerUid) ?? "" }
          : {}),
      })
    }
  }
}
