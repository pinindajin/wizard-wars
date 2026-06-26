/**
 * playerDeltaSystem – computes per-player state deltas for the current tick.
 *
 * Only fields that have changed since the previous tick are included in the
 * delta. `prevPlayerStates` is updated in-place for the next tick.
 *
 * The delta carries velocity (px/s), `moveState`, and `lastProcessedInputSeq`
 * in addition to position / facing / health so the client can run rewind-and-
 * replay reconciliation and velocity-aware remote interpolation.
 */
import { query, hasComponent } from "bitecs"

import {
  Position,
  Velocity,
  Facing,
  MoveFacing,
  Health,
  Lives,
  PlayerTag,
  InvulnerableTag,
  JumpArc,
  Equipment,
  TerrainState,
  TERRAIN_KIND_TO_STATE,
} from "../components"
import { computePlayerAnimState, getCastingAbilityId } from "../playerAnimState"
import { computePlayerMoveState } from "../playerMoveState"
import type { SimCtx } from "../simulation"
import type { PlayerDelta } from "../../../shared/types"
import { animUsesMouseAim } from "../../../shared/playerAnimAim"
import {
  abilityRuntimeStatesEqual,
  abilityRuntimeStatesForPlayer,
} from "../abilityRuntimeState"

type MutablePlayerDelta = {
  -readonly [Key in keyof PlayerDelta]: PlayerDelta[Key]
}

/**
 * Runs the player delta system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function playerDeltaSystem(ctx: SimCtx): void {
  const { world, prevPlayerStates, entityPlayerMap, lastProcessedInputSeqByPlayer } =
    ctx

  for (const eid of query(world, [PlayerTag])) {
    const prev = prevPlayerStates.get(eid)
    const userId = entityPlayerMap.get(eid) ?? ""
    const x = Position.x[eid]
    const y = Position.y[eid]
    const vx = Velocity.vx[eid]
    const vy = Velocity.vy[eid]
    const facingAngle = Facing.angle[eid]
    const moveFacingAngle = MoveFacing.angle[eid]
    const health = Health.current[eid]
    const lives = Lives.count[eid]
    const animState = computePlayerAnimState(world, eid)
    const moveState = computePlayerMoveState(world, eid)
    const invulnerable = hasComponent(world, eid, InvulnerableTag)
    const castingAbilityId = getCastingAbilityId(world, eid)
    const jumpZ = hasComponent(world, eid, JumpArc) ? JumpArc.z[eid] : 0
    const jumpStartedInLava =
      hasComponent(world, eid, JumpArc) && JumpArc.startedInLava[eid] === 1
    const hasSwiftBoots = Equipment.hasSwiftBoots[eid] === 1
    const terrainState = TERRAIN_KIND_TO_STATE[TerrainState.kind[eid]] ?? "land"
    const abilityStates = abilityRuntimeStatesForPlayer(eid, ctx.currentTick)
    const rawLastProcessedInputSeq = lastProcessedInputSeqByPlayer.get(userId)
    const hasProcessedInputSeq = rawLastProcessedInputSeq !== -1
    const lastProcessedInputSeq = Math.max(0, rawLastProcessedInputSeq ?? 0)
    const storedLastProcessedInputSeq = hasProcessedInputSeq ? lastProcessedInputSeq : -1

    if (!prev) {
      const fullDelta: MutablePlayerDelta = {
        id: eid,
        x,
        y,
        vx,
        vy,
        facingAngle,
        moveFacingAngle,
        health,
        lives,
        animState,
        moveState,
        castingAbilityId,
        invulnerable,
        jumpZ,
        jumpStartedInLava,
        hasSwiftBoots,
        terrainState,
        abilityStates,
      }
      if (hasProcessedInputSeq) {
        fullDelta.lastProcessedInputSeq = lastProcessedInputSeq
      }
      ctx.playerDeltas.push(fullDelta)
      prevPlayerStates.set(eid, {
        x,
        y,
        vx,
        vy,
        facingAngle,
        moveFacingAngle,
        health,
        lives,
        animState,
        moveState,
        castingAbilityId,
        invulnerable,
        jumpZ,
        jumpStartedInLava,
        hasSwiftBoots,
        terrainState,
        abilityStates,
        lastProcessedInputSeq: storedLastProcessedInputSeq,
      })
      continue
    }

    const animStateChanged = animState !== prev.animState
    const shouldRepeatAimFacing =
      animStateChanged && animUsesMouseAim(animState)

    const delta: MutablePlayerDelta = { id: eid }
    let changed = false
    if (x !== prev.x) {
      delta.x = x
      changed = true
    }
    if (y !== prev.y) {
      delta.y = y
      changed = true
    }
    if (vx !== prev.vx) {
      delta.vx = vx
      changed = true
    }
    if (vy !== prev.vy) {
      delta.vy = vy
      changed = true
    }
    if (facingAngle !== prev.facingAngle || shouldRepeatAimFacing) {
      delta.facingAngle = facingAngle
      changed = true
    }
    if (moveFacingAngle !== prev.moveFacingAngle) {
      delta.moveFacingAngle = moveFacingAngle
      changed = true
    }
    if (health !== prev.health) {
      delta.health = health
      changed = true
    }
    if (lives !== prev.lives) {
      delta.lives = lives
      changed = true
    }
    if (animStateChanged) {
      delta.animState = animState
      changed = true
    }
    if (moveState !== prev.moveState) {
      delta.moveState = moveState
      changed = true
    }
    if (castingAbilityId !== prev.castingAbilityId) {
      delta.castingAbilityId = castingAbilityId
      changed = true
    }
    if (invulnerable !== prev.invulnerable) {
      delta.invulnerable = invulnerable
      changed = true
    }
    if (jumpZ !== prev.jumpZ) {
      delta.jumpZ = jumpZ
      changed = true
    }
    if (jumpStartedInLava !== prev.jumpStartedInLava) {
      delta.jumpStartedInLava = jumpStartedInLava
      changed = true
    }
    if (hasSwiftBoots !== prev.hasSwiftBoots) {
      delta.hasSwiftBoots = hasSwiftBoots
      changed = true
    }
    if (terrainState !== prev.terrainState) {
      delta.terrainState = terrainState
      changed = true
    }
    if (!abilityRuntimeStatesEqual(abilityStates, prev.abilityStates)) {
      delta.abilityStates = abilityStates
      changed = true
    }
    if (hasProcessedInputSeq && lastProcessedInputSeq !== prev.lastProcessedInputSeq) {
      delta.lastProcessedInputSeq = lastProcessedInputSeq
      changed = true
    }

    if (changed) {
      ctx.playerDeltas.push(delta)
      prev.x = x
      prev.y = y
      prev.vx = vx
      prev.vy = vy
      prev.facingAngle = facingAngle
      prev.moveFacingAngle = moveFacingAngle
      prev.health = health
      prev.lives = lives
      prev.animState = animState
      prev.moveState = moveState
      prev.castingAbilityId = castingAbilityId
      prev.invulnerable = invulnerable
      prev.jumpZ = jumpZ
      prev.jumpStartedInLava = jumpStartedInLava
      prev.hasSwiftBoots = hasSwiftBoots
      prev.terrainState = terrainState
      prev.abilityStates = abilityStates
      if (hasProcessedInputSeq) {
        prev.lastProcessedInputSeq = lastProcessedInputSeq
      }
    }
  }
}
