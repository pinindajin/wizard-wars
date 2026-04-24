/**
 * inputSystem – reads the tick's inputMap and writes PlayerInput component fields
 * for every live player entity.
 *
 * Empty-queue ticks (no input received for a player this tick) are the
 * client/server scheduling-drift case: Phaser's RAF and the server's
 * `setInterval` are not phase-locked, so whenever the most recent client
 * payload arrives just after a tick boundary, the next tick sees an empty
 * queue. Zeroing all inputs in that case would freeze the player on the
 * server while the client keeps predicting forward — one tick worth of
 * authoritative motion per skipped tick, which reconciliation then paints
 * as rubberbanding.
 *
 * Fix (cause C): on empty-queue ticks, **retain** the previously committed
 * *held* input fields (WASD, weapon buttons, last aim target) and **clear
 * only the edge-triggered fields** (abilitySlot, useQuickItemSlot). Held
 * intent is edge-triggered by the human, not per-tick by the network, so
 * retaining it is the correct semantic. Edge-triggered casts are still
 * cleared so a single armed cast cannot fire twice when the queue stalls.
 */
import { query } from "bitecs"

import { PlayerInput, PlayerTag } from "../components"
import type { SimCtx } from "../simulation"

/**
 * Runs the input system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function inputSystem(ctx: SimCtx): void {
  const { world, entityPlayerMap, inputMap } = ctx

  for (const eid of query(world, [PlayerTag])) {
    const userId = entityPlayerMap.get(eid)
    const input = userId !== undefined ? inputMap.get(userId) : undefined

    if (!input) {
      // Retain held fields; clear only edge-triggered action fields.
      PlayerInput.abilitySlot[eid] = -1
      PlayerInput.useQuickItemSlot[eid] = -1
      continue
    }

    PlayerInput.up[eid] = input.up ? 1 : 0
    PlayerInput.down[eid] = input.down ? 1 : 0
    PlayerInput.left[eid] = input.left ? 1 : 0
    PlayerInput.right[eid] = input.right ? 1 : 0
    PlayerInput.weaponPrimary[eid] = input.weaponPrimary ? 1 : 0
    PlayerInput.weaponSecondary[eid] = input.weaponSecondary ? 1 : 0
    PlayerInput.abilitySlot[eid] = input.abilitySlot ?? -1
    PlayerInput.abilityTargetX[eid] = input.abilityTargetX
    PlayerInput.abilityTargetY[eid] = input.abilityTargetY
    PlayerInput.weaponTargetX[eid] = input.weaponTargetX
    PlayerInput.weaponTargetY[eid] = input.weaponTargetY
    PlayerInput.useQuickItemSlot[eid] = input.useQuickItemSlot ?? -1
    PlayerInput.seq[eid] = input.seq
  }
}
