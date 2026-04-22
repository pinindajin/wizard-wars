/**
 * deathSystem – transitions entities from DyingTag → DeadTag once the death
 * animation timer has expired.
 *
 * This system intentionally does NOT decrement lives or trigger respawn; that
 * is handled by livesRespawnSystem on the same tick.
 */
import { query, hasComponent, addComponent, removeComponent } from "bitecs"

import { PlayerTag, DyingTag, DeadTag } from "../components"
import type { SimCtx } from "../simulation"

/**
 * Runs the death system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function deathSystem(ctx: SimCtx): void {
  const { world, serverTimeMs } = ctx

  for (const eid of query(world, [PlayerTag, DyingTag])) {
    if (serverTimeMs < DyingTag.expiresAtMs[eid]) continue

    removeComponent(world, eid, DyingTag)
    addComponent(world, eid, DeadTag)
  }
}
