import { animUsesMouseAim } from "@/shared/playerAnimAim"
import type {
  AbilityRuntimeStates,
  FireballBatchUpdatePayload,
  HomingOrbBatchUpdatePayload,
  PlayerDelta,
} from "@/shared/types"

type FireballVisualBatch = Pick<
  FireballBatchUpdatePayload,
  "deltas" | "removedIds" | "serverTimeMs"
>

type HomingOrbVisualBatch = Pick<
  HomingOrbBatchUpdatePayload,
  "deltas" | "removedIds" | "serverTimeMs"
>

type Mutable<T> = {
  -readonly [K in keyof T]: T[K]
}

type FireballDelta = FireballBatchUpdatePayload["deltas"][number]
type HomingOrbDelta = HomingOrbBatchUpdatePayload["deltas"][number]
type PendingRow<T> = {
  readonly row: Mutable<T>
  readonly firstQueuedAtMs: number | undefined
}

export type VisualBudgetOptions = {
  readonly maxDeltas: number
  readonly maxRemovals: number
  readonly maxBytes: number
  readonly maxDeferralMs: number
  readonly serverTimeMs: number
}

export type VisualBudgetFlushStats = {
  readonly deferredEntities: number
  readonly maxDeferredAgeMs: number
}

export type PlayerBudgetedFlush = VisualBudgetFlushStats & {
  readonly deltas: readonly PlayerDelta[]
}

export type ProjectileBudgetedFlush<TBatch> = VisualBudgetFlushStats & {
  readonly batch: TBatch
}

export type SplitPlayerDeltaForVisualBudget = {
  readonly critical: PlayerDelta | null
  readonly visual: PlayerDelta | null
}

/**
 * Estimates serialized row size without JSON stringification in the hot path.
 *
 * @param row - Batch row to estimate.
 * @returns Approximate byte count for budget comparisons.
 */
function estimateRowBytes(row: Readonly<Record<string, unknown>>): number {
  let bytes = 2
  for (const [key, value] of Object.entries(row)) {
    bytes += key.length + 4
    if (typeof value === "number") {
      bytes += 8
    } else if (typeof value === "string") {
      bytes += value.length
    } else if (typeof value === "boolean") {
      bytes += 1
    } else if (value === null) {
      bytes += 4
    } else if (value !== undefined) {
      bytes += 24
    }
  }
  return bytes
}

/**
 * Calculates how long a pending visual row has waited.
 *
 * @param pending - Pending row metadata.
 * @param serverTimeMs - Current server wall-clock time.
 * @returns Non-negative deferral age in milliseconds.
 */
function pendingAgeMs<T>(
  pending: PendingRow<T>,
  serverTimeMs: number,
): number {
  if (pending.firstQueuedAtMs === undefined) return 0
  return Math.max(0, serverTimeMs - pending.firstQueuedAtMs)
}

/**
 * Returns whether adding a row would exceed a finite byte budget.
 *
 * @param maxBytes - Configured byte cap, or zero for unlimited.
 * @param usedBytes - Bytes already selected for this flush.
 * @param rowBytes - Estimated bytes for the candidate row.
 * @returns True when the row should be deferred for byte budget.
 */
function exceedsByteBudget(
  maxBytes: number,
  usedBytes: number,
  rowBytes: number,
): boolean {
  return maxBytes > 0 && usedBytes + rowBytes > maxBytes
}

/**
 * Copies ability HUD state so queued visual deltas cannot observe later mutation.
 *
 * @param abilityStates - Ability runtime state map from a player delta.
 * @returns A detached ability runtime state map.
 */
function cloneAbilityRuntimeStates(
  abilityStates: AbilityRuntimeStates,
): AbilityRuntimeStates {
  return Object.fromEntries(
    Object.entries(abilityStates).map(([abilityId, state]) => [
      abilityId,
      { ...state },
    ]),
  )
}

/**
 * Copies player visual delta fields into a detached pending row.
 *
 * @param target - Pending coalesced player delta row.
 * @param delta - Player delta row to snapshot.
 * @returns True when at least one room-wide visual field was copied.
 */
function copyPlayerVisualDeltaInto(
  target: Mutable<PlayerDelta>,
  delta: PlayerDelta,
): boolean {
  let copied = false
  if (delta.x !== undefined) {
    target.x = delta.x
    copied = true
  }
  if (delta.y !== undefined) {
    target.y = delta.y
    copied = true
  }
  if (delta.vx !== undefined) {
    target.vx = delta.vx
    copied = true
  }
  if (delta.vy !== undefined) {
    target.vy = delta.vy
    copied = true
  }
  if (delta.facingAngle !== undefined) {
    target.facingAngle = delta.facingAngle
    copied = true
  }
  if (delta.moveFacingAngle !== undefined) {
    target.moveFacingAngle = delta.moveFacingAngle
    copied = true
  }
  if (delta.health !== undefined) {
    target.health = delta.health
    copied = true
  }
  if (delta.lives !== undefined) {
    target.lives = delta.lives
    copied = true
  }
  if (delta.animState !== undefined) {
    target.animState = delta.animState
    copied = true
  }
  if (delta.moveState !== undefined) {
    target.moveState = delta.moveState
    copied = true
  }
  if (delta.terrainState !== undefined) {
    target.terrainState = delta.terrainState
    copied = true
  }
  if (delta.castingAbilityId !== undefined) {
    target.castingAbilityId = delta.castingAbilityId
    copied = true
  }
  if (delta.invulnerable !== undefined) {
    target.invulnerable = delta.invulnerable
    copied = true
  }
  if (delta.jumpZ !== undefined) {
    target.jumpZ = delta.jumpZ
    copied = true
  }
  if (delta.jumpStartedInLava !== undefined) {
    target.jumpStartedInLava = delta.jumpStartedInLava
    copied = true
  }
  if (delta.hasSwiftBoots !== undefined) {
    target.hasSwiftBoots = delta.hasSwiftBoots
    copied = true
  }
  if (delta.abilityStates !== undefined) {
    target.abilityStates = cloneAbilityRuntimeStates(delta.abilityStates)
    copied = true
  }
  return copied
}

/**
 * Splits one player delta into immediate semantic fields and budgetable visuals.
 *
 * Owner ACK cursors intentionally stay owner-only and are not returned in either
 * room-wide split.
 *
 * @param delta - Player delta from the authoritative simulation.
 * @returns Critical semantic fields and visual-only movement fields.
 */
export function splitPlayerDeltaForVisualBudget(
  delta: PlayerDelta,
): SplitPlayerDeltaForVisualBudget {
  const critical: Mutable<PlayerDelta> = { id: delta.id }
  const visual: Mutable<PlayerDelta> = { id: delta.id }
  const criticalNeedsFacing =
    delta.facingAngle !== undefined &&
    delta.animState !== undefined &&
    animUsesMouseAim(delta.animState)
  let hasCritical = false
  let hasVisual = false

  if (delta.x !== undefined && criticalNeedsFacing) {
    critical.x = delta.x
    hasCritical = true
  } else if (delta.x !== undefined) {
    visual.x = delta.x
    hasVisual = true
  }
  if (delta.y !== undefined && criticalNeedsFacing) {
    critical.y = delta.y
    hasCritical = true
  } else if (delta.y !== undefined) {
    visual.y = delta.y
    hasVisual = true
  }
  if (delta.vx !== undefined && criticalNeedsFacing) {
    critical.vx = delta.vx
    hasCritical = true
  } else if (delta.vx !== undefined) {
    visual.vx = delta.vx
    hasVisual = true
  }
  if (delta.vy !== undefined && criticalNeedsFacing) {
    critical.vy = delta.vy
    hasCritical = true
  } else if (delta.vy !== undefined) {
    visual.vy = delta.vy
    hasVisual = true
  }
  if (delta.facingAngle !== undefined && criticalNeedsFacing) {
    critical.facingAngle = delta.facingAngle
    hasCritical = true
  } else if (delta.facingAngle !== undefined) {
    visual.facingAngle = delta.facingAngle
    hasVisual = true
  }
  if (delta.moveFacingAngle !== undefined && criticalNeedsFacing) {
    critical.moveFacingAngle = delta.moveFacingAngle
    hasCritical = true
  } else if (delta.moveFacingAngle !== undefined) {
    visual.moveFacingAngle = delta.moveFacingAngle
    hasVisual = true
  }
  if (delta.health !== undefined) {
    critical.health = delta.health
    hasCritical = true
  }
  if (delta.lives !== undefined) {
    critical.lives = delta.lives
    hasCritical = true
  }
  if (delta.animState !== undefined) {
    critical.animState = delta.animState
    hasCritical = true
  }
  if (delta.moveState !== undefined) {
    critical.moveState = delta.moveState
    hasCritical = true
  }
  if (delta.terrainState !== undefined) {
    critical.terrainState = delta.terrainState
    hasCritical = true
  }
  if (delta.castingAbilityId !== undefined) {
    critical.castingAbilityId = delta.castingAbilityId
    hasCritical = true
  }
  if (delta.invulnerable !== undefined) {
    critical.invulnerable = delta.invulnerable
    hasCritical = true
  }
  if (delta.jumpZ !== undefined) {
    critical.jumpZ = delta.jumpZ
    hasCritical = true
  }
  if (delta.jumpStartedInLava !== undefined) {
    critical.jumpStartedInLava = delta.jumpStartedInLava
    hasCritical = true
  }
  if (delta.hasSwiftBoots !== undefined) {
    critical.hasSwiftBoots = delta.hasSwiftBoots
    hasCritical = true
  }
  if (delta.abilityStates !== undefined) {
    critical.abilityStates = cloneAbilityRuntimeStates(delta.abilityStates)
    hasCritical = true
  }

  return {
    critical: hasCritical ? critical : null,
    visual: hasVisual ? visual : null,
  }
}

/**
 * Copies one fireball movement delta row.
 *
 * @param delta - Fireball movement row to snapshot.
 * @returns A detached fireball delta row.
 */
function cloneFireballDelta(delta: FireballDelta): FireballDelta {
  return { id: delta.id, x: delta.x, y: delta.y }
}

/**
 * Copies fireball movement fields into a detached pending row.
 *
 * @param target - Pending coalesced fireball delta row.
 * @param delta - Fireball movement row to snapshot.
 */
function copyFireballDeltaInto(
  target: Mutable<FireballDelta>,
  delta: FireballDelta,
): void {
  target.x = delta.x
  target.y = delta.y
}

/**
 * Copies Homing Orb movement fields into a detached pending row.
 *
 * @param target - Pending coalesced Homing Orb delta row.
 * @param delta - Homing Orb movement row to snapshot.
 */
function copyHomingOrbDeltaInto(
  target: Mutable<HomingOrbDelta>,
  delta: HomingOrbDelta,
): void {
  if (delta.x !== undefined) target.x = delta.x
  if (delta.y !== undefined) target.y = delta.y
  if (delta.vx !== undefined) target.vx = delta.vx
  if (delta.vy !== undefined) target.vy = delta.vy
  if (delta.headingRad !== undefined) target.headingRad = delta.headingRad
  if (delta.targetId !== undefined) target.targetId = delta.targetId
}

/**
 * Incrementally coalesces cadence-limited player visual deltas.
 *
 * The coalescer preserves first-seen entity order while later fields win,
 * matching the legacy flush-time merge behavior.
 */
export class PlayerVisualBatchCoalescer {
  private readonly deltas = new Map<number, PendingRow<PlayerDelta>>()

  /**
   * Adds tick-local player deltas to the pending visual payload.
   *
   * @param deltas - Player delta rows from one simulation tick.
   * @param queuedAtMs - Optional server wall-clock time when rows entered the queue.
   */
  ingest(deltas: readonly PlayerDelta[], queuedAtMs?: number): void {
    for (const delta of deltas) {
      const pending = this.deltas.get(delta.id)
      const snapshot = pending?.row ?? { id: delta.id }
      if (!copyPlayerVisualDeltaInto(snapshot, delta)) continue
      this.deltas.set(delta.id, {
        row: snapshot,
        firstQueuedAtMs: pending?.firstQueuedAtMs ?? queuedAtMs,
      })
    }
  }

  /**
   * Returns whether a player visual payload is waiting to flush.
   *
   * @returns True when any player delta is pending.
   */
  hasPending(): boolean {
    return this.deltas.size > 0
  }

  /**
   * Reads a pending player visual row without removing it.
   *
   * @param id - Player entity id to read from the pending visual payload.
   * @returns Pending player visual row, or null when none is queued.
   */
  peek(id: number): PlayerDelta | null {
    return this.deltas.get(id)?.row ?? null
  }

  /**
   * Drops a pending player visual row superseded by a newer immediate sample.
   *
   * @param id - Player entity id to remove from the pending visual payload.
   */
  drop(id: number): void {
    this.deltas.delete(id)
  }

  /**
   * Emits and clears the pending player visual payload.
   *
   * @returns Coalesced player deltas ready for `PlayerBatchUpdate`.
   */
  flush(): readonly PlayerDelta[] {
    const deltas = [...this.deltas.values()].map((pending) => pending.row)
    this.clear()
    return deltas
  }

  /**
   * Emits a budgeted subset while retaining deferred player rows.
   *
   * @param options - Visual send-budget limits for this flush.
   * @returns Selected player deltas and deferred-row stats.
   */
  flushBudgeted(options: VisualBudgetOptions): PlayerBudgetedFlush {
    const selected: PlayerDelta[] = []
    const selectedIds: number[] = []
    let usedBytes = 0
    let maxAgeMs = 0

    for (const [id, pending] of this.deltas) {
      const rowBytes = estimateRowBytes(pending.row)
      const ageMs = pendingAgeMs(pending, options.serverTimeMs)
      maxAgeMs = Math.max(maxAgeMs, ageMs)
      const maxDeltasReached =
        options.maxDeltas > 0 && selected.length >= options.maxDeltas
      const forcedByAge = ageMs >= options.maxDeferralMs
      if (
        !forcedByAge &&
        (maxDeltasReached ||
          exceedsByteBudget(options.maxBytes, usedBytes, rowBytes))
      ) {
        continue
      }
      selected.push(pending.row)
      selectedIds.push(id)
      usedBytes += rowBytes
    }

    for (const id of selectedIds) {
      this.deltas.delete(id)
    }

    return {
      deltas: selected,
      ...this.deferredStats(options.serverTimeMs, maxAgeMs),
    }
  }

  /**
   * Summarizes rows left pending after a budgeted flush.
   *
   * @param serverTimeMs - Current server wall-clock time.
   * @returns Deferred entity count and maximum age.
   */
  private deferredStats(
    serverTimeMs: number,
    initialMaxAgeMs = 0,
  ): VisualBudgetFlushStats {
    let maxDeferredAgeMs = initialMaxAgeMs
    for (const pending of this.deltas.values()) {
      maxDeferredAgeMs = Math.max(maxDeferredAgeMs, pendingAgeMs(pending, serverTimeMs))
    }
    return {
      deferredEntities: this.deltas.size,
      maxDeferredAgeMs,
    }
  }

  /**
   * Drops all pending player visual deltas.
   */
  clear(): void {
    this.deltas.clear()
  }
}

/**
 * Incrementally coalesces cadence-limited fireball movement and removals.
 */
export class FireballVisualBatchCoalescer {
  private readonly deltas = new Map<number, PendingRow<FireballDelta>>()
  private readonly removedIds = new Map<number, number | undefined>()
  private serverTimeMs: number | undefined

  /**
   * Adds one tick-local fireball movement/removal batch.
   *
   * @param batch - Fireball deltas and removals from one simulation tick.
   */
  ingest(batch: FireballVisualBatch): void {
    if (batch.deltas.length === 0 && batch.removedIds.length === 0) return
    if (batch.serverTimeMs !== undefined) this.serverTimeMs = batch.serverTimeMs
    for (const delta of batch.deltas) {
      this.removedIds.delete(delta.id)
      const pending = this.deltas.get(delta.id)
      if (pending) {
        copyFireballDeltaInto(pending.row, delta)
      } else {
        this.deltas.set(delta.id, {
          row: cloneFireballDelta(delta),
          firstQueuedAtMs: batch.serverTimeMs,
        })
      }
    }
    for (const id of batch.removedIds) {
      this.removedIds.set(id, batch.serverTimeMs)
      this.deltas.delete(id)
    }
  }

  /**
   * Returns whether a fireball visual payload is waiting to flush.
   *
   * @returns True when fireball deltas or removals are pending.
   */
  hasPending(): boolean {
    return this.deltas.size > 0 || this.removedIds.size > 0
  }

  /**
   * Emits and clears the pending fireball visual payload.
   *
   * @returns Coalesced fireball deltas/removals ready for `FireballBatchUpdate`.
   */
  flush(): FireballVisualBatch {
    const batch = {
      deltas: [...this.deltas.values()].map((pending) => pending.row),
      removedIds: [...this.removedIds.keys()],
      ...(this.serverTimeMs !== undefined ? { serverTimeMs: this.serverTimeMs } : {}),
    }
    this.clear()
    return batch
  }

  /**
   * Emits a budgeted subset while retaining deferred fireball rows/removals.
   *
   * @param options - Visual send-budget limits for this flush.
   * @returns Selected fireball batch and deferred-row stats.
   */
  flushBudgeted(
    options: VisualBudgetOptions,
  ): ProjectileBudgetedFlush<FireballVisualBatch> {
    const deltas: FireballDelta[] = []
    const removedIds: number[] = []
    const selectedDeltaIds: number[] = []
    const selectedRemovalIds: number[] = []
    let usedBytes = 0
    let maxAgeMs = 0

    for (const [id, queuedAtMs] of this.removedIds) {
      const rowBytes = estimateRowBytes({ id })
      const ageMs = Math.max(0, options.serverTimeMs - (queuedAtMs ?? options.serverTimeMs))
      maxAgeMs = Math.max(maxAgeMs, ageMs)
      const maxRemovalsReached =
        options.maxRemovals > 0 && removedIds.length >= options.maxRemovals
      const forcedByAge = ageMs >= options.maxDeferralMs
      if (
        !forcedByAge &&
        (maxRemovalsReached ||
          exceedsByteBudget(options.maxBytes, usedBytes, rowBytes))
      ) {
        continue
      }
      removedIds.push(id)
      selectedRemovalIds.push(id)
      usedBytes += rowBytes
    }

    for (const [id, pending] of this.deltas) {
      const rowBytes = estimateRowBytes(pending.row)
      const ageMs = pendingAgeMs(pending, options.serverTimeMs)
      maxAgeMs = Math.max(maxAgeMs, ageMs)
      const maxDeltasReached =
        options.maxDeltas > 0 && deltas.length >= options.maxDeltas
      const forcedByAge = ageMs >= options.maxDeferralMs
      if (
        !forcedByAge &&
        (maxDeltasReached ||
          exceedsByteBudget(options.maxBytes, usedBytes, rowBytes))
      ) {
        continue
      }
      deltas.push(pending.row)
      selectedDeltaIds.push(id)
      usedBytes += rowBytes
    }

    for (const id of selectedRemovalIds) {
      this.removedIds.delete(id)
    }
    for (const id of selectedDeltaIds) {
      this.deltas.delete(id)
    }

    return {
      batch: {
        deltas,
        removedIds,
        ...(this.serverTimeMs !== undefined ? { serverTimeMs: this.serverTimeMs } : {}),
      },
      ...this.deferredStats(options.serverTimeMs, maxAgeMs),
    }
  }

  /**
   * Summarizes fireball rows/removals left pending after a budgeted flush.
   *
   * @param serverTimeMs - Current server wall-clock time.
   * @returns Deferred entity count and maximum age.
   */
  private deferredStats(
    serverTimeMs: number,
    initialMaxAgeMs = 0,
  ): VisualBudgetFlushStats {
    let maxDeferredAgeMs = initialMaxAgeMs
    for (const pending of this.deltas.values()) {
      maxDeferredAgeMs = Math.max(maxDeferredAgeMs, pendingAgeMs(pending, serverTimeMs))
    }
    for (const queuedAtMs of this.removedIds.values()) {
      maxDeferredAgeMs = Math.max(
        maxDeferredAgeMs,
        Math.max(0, serverTimeMs - (queuedAtMs ?? serverTimeMs)),
      )
    }
    return {
      deferredEntities: this.deltas.size + this.removedIds.size,
      maxDeferredAgeMs,
    }
  }

  /**
   * Drops all pending fireball visual deltas/removals.
   */
  clear(): void {
    this.deltas.clear()
    this.removedIds.clear()
    this.serverTimeMs = undefined
  }
}

/**
 * Incrementally coalesces cadence-limited Homing Orb movement and removals.
 */
export class HomingOrbVisualBatchCoalescer {
  private readonly deltas = new Map<number, PendingRow<HomingOrbDelta>>()
  private readonly removedIds = new Map<number, number | undefined>()
  private serverTimeMs: number | undefined

  /**
   * Adds one tick-local Homing Orb movement/removal batch.
   *
   * @param batch - Homing Orb deltas and removals from one simulation tick.
   */
  ingest(batch: HomingOrbVisualBatch): void {
    if (batch.deltas.length === 0 && batch.removedIds.length === 0) return
    if (batch.serverTimeMs !== undefined) this.serverTimeMs = batch.serverTimeMs
    for (const delta of batch.deltas) {
      this.removedIds.delete(delta.id)
      let pending = this.deltas.get(delta.id)
      if (!pending) {
        pending = {
          row: { id: delta.id },
          firstQueuedAtMs: batch.serverTimeMs,
        }
        this.deltas.set(delta.id, pending)
      }
      copyHomingOrbDeltaInto(pending.row, delta)
    }
    for (const id of batch.removedIds) {
      this.removedIds.set(id, batch.serverTimeMs)
      this.deltas.delete(id)
    }
  }

  /**
   * Returns whether a Homing Orb visual payload is waiting to flush.
   *
   * @returns True when Homing Orb deltas or removals are pending.
   */
  hasPending(): boolean {
    return this.deltas.size > 0 || this.removedIds.size > 0
  }

  /**
   * Emits and clears the pending Homing Orb visual payload.
   *
   * @returns Coalesced Homing Orb deltas/removals ready for `HomingOrbBatchUpdate`.
   */
  flush(): HomingOrbVisualBatch {
    const batch = {
      deltas: [...this.deltas.values()].map((pending) => pending.row),
      removedIds: [...this.removedIds.keys()],
      ...(this.serverTimeMs !== undefined ? { serverTimeMs: this.serverTimeMs } : {}),
    }
    this.clear()
    return batch
  }

  /**
   * Emits a budgeted subset while retaining deferred Homing Orb rows/removals.
   *
   * @param options - Visual send-budget limits for this flush.
   * @returns Selected Homing Orb batch and deferred-row stats.
   */
  flushBudgeted(
    options: VisualBudgetOptions,
  ): ProjectileBudgetedFlush<HomingOrbVisualBatch> {
    const deltas: HomingOrbDelta[] = []
    const removedIds: number[] = []
    const selectedDeltaIds: number[] = []
    const selectedRemovalIds: number[] = []
    let usedBytes = 0
    let maxAgeMs = 0

    for (const [id, queuedAtMs] of this.removedIds) {
      const rowBytes = estimateRowBytes({ id })
      const ageMs = Math.max(0, options.serverTimeMs - (queuedAtMs ?? options.serverTimeMs))
      maxAgeMs = Math.max(maxAgeMs, ageMs)
      const maxRemovalsReached =
        options.maxRemovals > 0 && removedIds.length >= options.maxRemovals
      const forcedByAge = ageMs >= options.maxDeferralMs
      if (
        !forcedByAge &&
        (maxRemovalsReached ||
          exceedsByteBudget(options.maxBytes, usedBytes, rowBytes))
      ) {
        continue
      }
      removedIds.push(id)
      selectedRemovalIds.push(id)
      usedBytes += rowBytes
    }

    for (const [id, pending] of this.deltas) {
      const rowBytes = estimateRowBytes(pending.row)
      const ageMs = pendingAgeMs(pending, options.serverTimeMs)
      maxAgeMs = Math.max(maxAgeMs, ageMs)
      const maxDeltasReached =
        options.maxDeltas > 0 && deltas.length >= options.maxDeltas
      const forcedByAge = ageMs >= options.maxDeferralMs
      if (
        !forcedByAge &&
        (maxDeltasReached ||
          exceedsByteBudget(options.maxBytes, usedBytes, rowBytes))
      ) {
        continue
      }
      deltas.push(pending.row)
      selectedDeltaIds.push(id)
      usedBytes += rowBytes
    }

    for (const id of selectedRemovalIds) {
      this.removedIds.delete(id)
    }
    for (const id of selectedDeltaIds) {
      this.deltas.delete(id)
    }

    return {
      batch: {
        deltas,
        removedIds,
        ...(this.serverTimeMs !== undefined ? { serverTimeMs: this.serverTimeMs } : {}),
      },
      ...this.deferredStats(options.serverTimeMs, maxAgeMs),
    }
  }

  /**
   * Summarizes Homing Orb rows/removals left pending after a budgeted flush.
   *
   * @param serverTimeMs - Current server wall-clock time.
   * @returns Deferred entity count and maximum age.
   */
  private deferredStats(
    serverTimeMs: number,
    initialMaxAgeMs = 0,
  ): VisualBudgetFlushStats {
    let maxDeferredAgeMs = initialMaxAgeMs
    for (const pending of this.deltas.values()) {
      maxDeferredAgeMs = Math.max(maxDeferredAgeMs, pendingAgeMs(pending, serverTimeMs))
    }
    for (const queuedAtMs of this.removedIds.values()) {
      maxDeferredAgeMs = Math.max(
        maxDeferredAgeMs,
        Math.max(0, serverTimeMs - (queuedAtMs ?? serverTimeMs)),
      )
    }
    return {
      deferredEntities: this.deltas.size + this.removedIds.size,
      maxDeferredAgeMs,
    }
  }

  /**
   * Drops all pending Homing Orb visual deltas/removals.
   */
  clear(): void {
    this.deltas.clear()
    this.removedIds.clear()
    this.serverTimeMs = undefined
  }
}

/**
 * Merges tick-local player delta arrays into one payload-ready delta list.
 *
 * @param batches - Ordered player delta batches.
 * @returns Merged deltas preserving first-seen entity order.
 */
export function mergePlayerBatch(
  batches: readonly (readonly PlayerDelta[])[],
): readonly PlayerDelta[] {
  const coalescer = new PlayerVisualBatchCoalescer()
  for (const batch of batches) {
    coalescer.ingest(batch)
  }
  return coalescer.flush()
}

/**
 * Merges tick-local fireball delta batches into one payload-ready batch.
 *
 * @param batches - Ordered fireball delta and removal batches.
 * @returns Merged fireball batch.
 */
export function mergeFireballBatch(
  batches: readonly FireballVisualBatch[],
): FireballVisualBatch {
  const coalescer = new FireballVisualBatchCoalescer()
  for (const batch of batches) {
    coalescer.ingest(batch)
  }
  return coalescer.flush()
}

/**
 * Merges tick-local Homing Orb delta batches into one payload-ready batch.
 *
 * @param batches - Ordered Homing Orb delta and removal batches.
 * @returns Merged Homing Orb batch.
 */
export function mergeHomingOrbBatch(
  batches: readonly HomingOrbVisualBatch[],
): HomingOrbVisualBatch {
  const coalescer = new HomingOrbVisualBatchCoalescer()
  for (const batch of batches) {
    coalescer.ingest(batch)
  }
  return coalescer.flush()
}
