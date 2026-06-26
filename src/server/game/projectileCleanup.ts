import type { SimCtx } from "./simulation"

/**
 * Removes a Fireball from all cross-tick maps and queues entity removal.
 *
 * @param ctx - Simulation context.
 * @param fireballEid - Fireball entity id.
 */
export function removeFireballProjectile(ctx: SimCtx, fireballEid: number): void {
  ctx.fireballRemovedIds.push(fireballEid)
  ctx.fireballOwnerMap.delete(fireballEid)
  ctx.fireballCreatedAtTickMap.delete(fireballEid)
  ctx.prevFireballStates.delete(fireballEid)
  ctx.commandBuffer.enqueue({ type: "removeEntity", eid: fireballEid })
}
