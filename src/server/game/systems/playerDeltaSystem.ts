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
} from "../components"
import { computePlayerAnimState, getCastingAbilityId } from "../playerAnimState"
import { computePlayerMoveState } from "../playerMoveState"
import type { SimCtx } from "../simulation"
import type { PlayerDelta } from "../../../shared/types"

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
    const lastProcessedInputSeq = Math.max(
      0,
      lastProcessedInputSeqByPlayer.get(userId) ?? 0,
    )

    if (!prev) {
      ctx.playerDeltas.push({
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
        lastProcessedInputSeq,
      })
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
        lastProcessedInputSeq,
      })
      continue
    }

    const delta: PlayerDelta = {
      id: eid,
      ...(x !== prev.x ? { x } : {}),
      ...(y !== prev.y ? { y } : {}),
      ...(vx !== prev.vx ? { vx } : {}),
      ...(vy !== prev.vy ? { vy } : {}),
      ...(facingAngle !== prev.facingAngle ? { facingAngle } : {}),
      ...(moveFacingAngle !== prev.moveFacingAngle ? { moveFacingAngle } : {}),
      ...(health !== prev.health ? { health } : {}),
      ...(lives !== prev.lives ? { lives } : {}),
      ...(animState !== prev.animState ? { animState } : {}),
      ...(moveState !== prev.moveState ? { moveState } : {}),
      ...(castingAbilityId !== prev.castingAbilityId ? { castingAbilityId } : {}),
      ...(invulnerable !== prev.invulnerable ? { invulnerable } : {}),
      ...(jumpZ !== prev.jumpZ ? { jumpZ } : {}),
      ...(lastProcessedInputSeq !== prev.lastProcessedInputSeq
        ? { lastProcessedInputSeq }
        : {}),
    }

    const changed =
      delta.x !== undefined ||
      delta.y !== undefined ||
      delta.vx !== undefined ||
      delta.vy !== undefined ||
      delta.facingAngle !== undefined ||
      delta.moveFacingAngle !== undefined ||
      delta.health !== undefined ||
      delta.lives !== undefined ||
      delta.animState !== undefined ||
      delta.moveState !== undefined ||
      delta.castingAbilityId !== undefined ||
      delta.invulnerable !== undefined ||
      delta.jumpZ !== undefined ||
      delta.lastProcessedInputSeq !== undefined

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
      prev.lastProcessedInputSeq = lastProcessedInputSeq
    }
  }
}
