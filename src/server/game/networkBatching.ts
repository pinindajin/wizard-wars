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
  private readonly deltas = new Map<number, Mutable<PlayerDelta>>()

  /**
   * Adds tick-local player deltas to the pending visual payload.
   *
   * @param deltas - Player delta rows from one simulation tick.
   */
  ingest(deltas: readonly PlayerDelta[]): void {
    for (const delta of deltas) {
      let snapshot = this.deltas.get(delta.id)
      if (!snapshot) {
        snapshot = { id: delta.id }
      }
      if (!copyPlayerVisualDeltaInto(snapshot, delta)) continue
      this.deltas.set(delta.id, snapshot)
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
   * Emits and clears the pending player visual payload.
   *
   * @returns Coalesced player deltas ready for `PlayerBatchUpdate`.
   */
  flush(): readonly PlayerDelta[] {
    const deltas = [...this.deltas.values()]
    this.clear()
    return deltas
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
  private readonly deltas = new Map<number, Mutable<FireballDelta>>()
  private readonly removedIds = new Set<number>()
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
      const snapshot = this.deltas.get(delta.id)
      if (snapshot) {
        copyFireballDeltaInto(snapshot, delta)
      } else {
        this.deltas.set(delta.id, cloneFireballDelta(delta))
      }
    }
    for (const id of batch.removedIds) {
      this.removedIds.add(id)
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
      deltas: [...this.deltas.values()],
      removedIds: [...this.removedIds.values()],
      ...(this.serverTimeMs !== undefined ? { serverTimeMs: this.serverTimeMs } : {}),
    }
    this.clear()
    return batch
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
  private readonly deltas = new Map<number, Mutable<HomingOrbDelta>>()
  private readonly removedIds = new Set<number>()
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
      let snapshot = this.deltas.get(delta.id)
      if (!snapshot) {
        snapshot = { id: delta.id }
        this.deltas.set(delta.id, snapshot)
      }
      copyHomingOrbDeltaInto(snapshot, delta)
    }
    for (const id of batch.removedIds) {
      this.removedIds.add(id)
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
      deltas: [...this.deltas.values()],
      removedIds: [...this.removedIds.values()],
      ...(this.serverTimeMs !== undefined ? { serverTimeMs: this.serverTimeMs } : {}),
    }
    this.clear()
    return batch
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
