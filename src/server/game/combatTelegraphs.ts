import type {
  CombatTelegraphEndPayload,
  CombatTelegraphStartPayload,
} from "../../shared/types"
import type { SimCtx } from "./simulation"

/**
 * Builds a stable telegraph id for one cast/attack instance.
 *
 * @param kind - Source domain such as `spell` or `primary`.
 * @param casterUserId - Server user id of the caster.
 * @param sourceId - Ability or attack id.
 * @param startTick - Simulation tick that accepted the action.
 * @returns Stable telegraph id.
 */
export function combatTelegraphId(
  kind: "spell" | "primary",
  casterUserId: string,
  sourceId: string,
  startTick: number,
): string {
  return `${kind}:${casterUserId}:${sourceId}:${startTick}`
}

/**
 * Starts or replaces an active combat telegraph and queues its start payload.
 *
 * @param ctx - Simulation context.
 * @param payload - Telegraph payload shared with clients/full sync.
 */
export function startCombatTelegraph(
  ctx: SimCtx,
  payload: CombatTelegraphStartPayload,
): void {
  ctx.activeCombatTelegraphs.set(payload.id, payload)
  ctx.combatTelegraphStarts.push(payload)
}

/**
 * Ends an active combat telegraph and queues a removal payload if it existed.
 *
 * @param ctx - Simulation context.
 * @param id - Telegraph id to remove.
 * @param reason - Removal reason sent to clients.
 */
export function endCombatTelegraph(
  ctx: SimCtx,
  id: string,
  reason: CombatTelegraphEndPayload["reason"],
): void {
  if (!ctx.activeCombatTelegraphs.delete(id)) return
  ctx.combatTelegraphEnds.push({ id, reason })
}
