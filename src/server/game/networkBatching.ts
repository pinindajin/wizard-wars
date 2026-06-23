import type {
  FireballBatchUpdatePayload,
  HomingOrbBatchUpdatePayload,
  PlayerDelta,
} from "@/shared/types"

/**
 * Merges tick-local player delta arrays into one payload-ready delta list.
 *
 * @param batches - Ordered player delta batches.
 * @returns Merged deltas preserving first-seen entity order.
 */
export function mergePlayerBatch(
  batches: readonly (readonly PlayerDelta[])[],
): readonly PlayerDelta[] {
  const merged = new Map<number, PlayerDelta>()
  for (const batch of batches) {
    for (const delta of batch) {
      merged.set(delta.id, { ...(merged.get(delta.id) ?? { id: delta.id }), ...delta })
    }
  }
  return [...merged.values()]
}

/**
 * Merges tick-local fireball delta batches into one payload-ready batch.
 *
 * @param batches - Ordered fireball delta and removal batches.
 * @returns Merged fireball batch.
 */
export function mergeFireballBatch(
  batches: readonly Pick<FireballBatchUpdatePayload, "deltas" | "removedIds" | "serverTimeMs">[],
): Pick<FireballBatchUpdatePayload, "deltas" | "removedIds" | "serverTimeMs"> {
  const deltas = new Map<number, { id: number; x: number; y: number }>()
  const removedIds = new Set<number>()
  let serverTimeMs: number | undefined
  for (const batch of batches) {
    if (batch.serverTimeMs !== undefined) serverTimeMs = batch.serverTimeMs
    for (const delta of batch.deltas) {
      removedIds.delete(delta.id)
      deltas.set(delta.id, delta)
    }
    for (const id of batch.removedIds) {
      removedIds.add(id)
      deltas.delete(id)
    }
  }
  return {
    deltas: [...deltas.values()],
    removedIds: [...removedIds.values()],
    ...(serverTimeMs !== undefined ? { serverTimeMs } : {}),
  }
}

/**
 * Merges tick-local Homing Orb delta batches into one payload-ready batch.
 *
 * @param batches - Ordered Homing Orb delta and removal batches.
 * @returns Merged Homing Orb batch.
 */
export function mergeHomingOrbBatch(
  batches: readonly Pick<HomingOrbBatchUpdatePayload, "deltas" | "removedIds" | "serverTimeMs">[],
): Pick<HomingOrbBatchUpdatePayload, "deltas" | "removedIds" | "serverTimeMs"> {
  const deltas = new Map<number, HomingOrbBatchUpdatePayload["deltas"][number]>()
  const removedIds = new Set<number>()
  let serverTimeMs: number | undefined
  for (const batch of batches) {
    if (batch.serverTimeMs !== undefined) serverTimeMs = batch.serverTimeMs
    for (const delta of batch.deltas) {
      removedIds.delete(delta.id)
      deltas.set(delta.id, { ...(deltas.get(delta.id) ?? { id: delta.id }), ...delta })
    }
    for (const id of batch.removedIds) {
      removedIds.add(id)
      deltas.delete(id)
    }
  }
  return {
    deltas: [...deltas.values()],
    removedIds: [...removedIds.values()],
    ...(serverTimeMs !== undefined ? { serverTimeMs } : {}),
  }
}
