import type { PlayerInputPayload } from "@/shared/types"

/**
 * Merges the latest buffered `PlayerInput` with a pending ability slot for one
 * server tick. When `pendingAbilitySlot` is set, it overrides
 * `latest.abilitySlot` so a movement-only follow-up message does not erase a
 * press that arrived earlier in the same 50ms window. **Last non-null**
 * `abilitySlot` is enforced by the caller: they must set `pendingAbilitySlot`
 * to the most recent non-null slot before the tick.
 *
 * @param latest - The latest validated payload from `inputBuffer` for this player.
 * @param pendingAbilitySlot - Set when at least one message in this window had
 *   `abilitySlot != null` (use `undefined` when there is no pending press).
 * @returns A full payload to pass to the simulation for this tick.
 */
export function mergePlayerInputForTick(
  latest: PlayerInputPayload,
  pendingAbilitySlot: number | undefined,
): PlayerInputPayload {
  if (pendingAbilitySlot === undefined) return latest
  return { ...latest, abilitySlot: pendingAbilitySlot }
}
