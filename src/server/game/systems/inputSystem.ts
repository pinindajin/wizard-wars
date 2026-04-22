/**
 * inputSystem – reads the tick's inputMap and writes PlayerInput component fields
 * for every live player entity.
 *
 * Entities with no entry in the inputMap receive zeroed inputs (treat as idle).
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
      PlayerInput.up[eid] = 0
      PlayerInput.down[eid] = 0
      PlayerInput.left[eid] = 0
      PlayerInput.right[eid] = 0
      PlayerInput.weaponPrimary[eid] = 0
      PlayerInput.weaponSecondary[eid] = 0
      PlayerInput.abilitySlot[eid] = -1
      PlayerInput.abilityTargetX[eid] = 0
      PlayerInput.abilityTargetY[eid] = 0
      PlayerInput.weaponTargetX[eid] = 0
      PlayerInput.weaponTargetY[eid] = 0
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
