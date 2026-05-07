import type {
  AbilityRuntimeStates,
  GameStateSyncPayload,
  PlayerBatchUpdatePayload,
} from "@/shared/types"

export type ServerClockSample = {
  readonly serverTimeMs: number
  readonly receivedAtMs: number
}

export const EMPTY_ABILITY_RUNTIME_STATES: AbilityRuntimeStates = {}

/**
 * Creates a local sample that ties server time to the local receipt time.
 *
 * @param serverTimeMs - Server wall-clock time from a sync or batch payload.
 * @param receivedAtMs - Local wall-clock time when the payload was handled.
 * @returns Server clock sample used by React HUD countdowns.
 */
export function sampleServerClock(
  serverTimeMs: number,
  receivedAtMs = Date.now(),
): ServerClockSample {
  return { serverTimeMs, receivedAtMs }
}

/**
 * Estimates current server time from the most recent sample.
 *
 * @param sample - Last server clock sample, or null before sync.
 * @param nowMs - Local wall-clock time at render/update.
 * @returns Estimated current server time in milliseconds.
 */
export function estimateServerNowMs(
  sample: ServerClockSample | null,
  nowMs = Date.now(),
): number {
  if (!sample) return nowMs
  return sample.serverTimeMs + Math.max(0, nowMs - sample.receivedAtMs)
}

/**
 * Reads the local player's ability runtime state from a full sync payload.
 *
 * @param payload - Full game state sync payload.
 * @param localPlayerId - Current user's player id.
 * @returns Ability runtime states for the local player, or empty states.
 */
export function abilityStatesFromFullSync(
  payload: GameStateSyncPayload,
  localPlayerId: string | null,
): AbilityRuntimeStates {
  if (!localPlayerId) return EMPTY_ABILITY_RUNTIME_STATES
  return (
    payload.players.find((player) => player.playerId === localPlayerId)?.abilityStates ??
    EMPTY_ABILITY_RUNTIME_STATES
  )
}

/**
 * Applies local-player ability state deltas from a batch payload.
 *
 * @param current - Current ability runtime states.
 * @param payload - Player batch update payload.
 * @param localPlayerId - Current user's player id.
 * @param entityToPlayer - Entity id → player id map from full sync.
 * @returns Updated ability states when a local delta has them; otherwise current.
 */
export function abilityStatesFromBatchDelta(
  current: AbilityRuntimeStates,
  payload: PlayerBatchUpdatePayload,
  localPlayerId: string | null,
  entityToPlayer: ReadonlyMap<number, string>,
): AbilityRuntimeStates {
  if (!localPlayerId) return current
  for (const delta of payload.deltas) {
    if (entityToPlayer.get(delta.id) !== localPlayerId) continue
    if (delta.abilityStates === undefined) continue
    return delta.abilityStates
  }
  return current
}
