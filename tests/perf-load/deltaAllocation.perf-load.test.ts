import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { performance } from "node:perf_hooks"

import { describe, expect, it } from "vitest"

import { sanitizePerfRunId } from "@/server/game/performanceConfig"
import type {
  AbilityRuntimeStates,
  PlayerAnimState,
  PlayerDelta,
  PlayerMoveState,
  PlayerTerrainState,
} from "@/shared/types"
import type { HomingOrbDelta } from "@/server/game/simulation"

const PLAYER_COUNT = 192
const HOMING_ORB_COUNT = 384
const ROUNDS = 96
const PLAYER_SPARSE_SPREAD_BRANCHES = 18

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key]
}

type SyntheticPlayerState = {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly facingAngle: number
  readonly moveFacingAngle: number
  readonly health: number
  readonly lives: number
  readonly animState: PlayerAnimState
  readonly moveState: PlayerMoveState
  readonly terrainState: PlayerTerrainState
  readonly castingAbilityId: string | null
  readonly invulnerable: boolean
  readonly jumpZ: number
  readonly jumpStartedInLava: boolean
  readonly hasSwiftBoots: boolean
  readonly abilityStates: AbilityRuntimeStates
  readonly lastProcessedInputSeq: number
  readonly hasProcessedInputSeq: boolean
}

type SyntheticHomingOrbState = {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly headingRad: number
  readonly targetId?: string
}

type Pair<T> = {
  readonly prev: T
  readonly current: T
}

type BenchmarkMetrics = {
  readonly totalMs: number
  readonly p95Ms: number
  readonly deltaCount: number
  readonly checksum: number
  readonly estimatedTemporaryObjects: number
}

type DeltaAllocationReport = {
  readonly runId: string
  readonly playerCount: number
  readonly homingOrbCount: number
  readonly rounds: number
  readonly baselineSpreadObjectKeys: BenchmarkMetrics
  readonly mutableChangedFlag: BenchmarkMetrics
}

type PlayerDeltaBuilder = (
  prev: SyntheticPlayerState,
  current: SyntheticPlayerState,
) => PlayerDelta | null

type HomingOrbDeltaBuilder = (
  prev: SyntheticHomingOrbState,
  current: SyntheticHomingOrbState,
) => HomingOrbDelta | null

/**
 * Builds one deterministic runtime-state payload for parity checks.
 *
 * @param seed - Stable integer seed.
 * @returns Ability runtime states.
 */
function abilityStates(seed: number): AbilityRuntimeStates {
  return {
    fireball: {
      cooldownEndsAtServerTimeMs: seed % 5 === 0 ? 2_000 + seed : null,
      cooldownDurationMs: seed % 5 === 0 ? 800 : null,
      charges: null,
      maxCharges: null,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
    lightning_bolt: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: null,
      maxCharges: null,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
    homing_orb: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: 4 - (seed % 3),
      maxCharges: 4,
      rechargeEndsAtServerTimeMs: seed % 7 === 0 ? 4_000 + seed : null,
      rechargeDurationMs: seed % 7 === 0 ? 2_000 : null,
    },
    jump: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: 3 - (seed % 2),
      maxCharges: 4,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
  }
}

/**
 * Builds one deterministic player state for a benchmark round.
 *
 * @param id - Entity id.
 * @param roundIndex - Benchmark round.
 * @param variant - Previous/current variant offset.
 * @returns Synthetic player state.
 */
function playerState(
  id: number,
  roundIndex: number,
  variant: number,
): SyntheticPlayerState {
  const seed = id * 13 + roundIndex * 17 + variant
  const castingAbilityId =
    seed % 11 === 0 ? "fireball" : seed % 13 === 0 ? "homing_orb" : null
  return {
    id,
    x: 64 + (id % 24) * 20 + (seed % 3),
    y: 96 + Math.floor(id / 24) * 22 + (seed % 5),
    vx: (seed % 9) - 4,
    vy: ((seed + 3) % 9) - 4,
    facingAngle: ((seed % 360) * Math.PI) / 180,
    moveFacingAngle: (((seed + 45) % 360) * Math.PI) / 180,
    health: 100 - (seed % 37),
    lives: 1 + (seed % 3),
    animState: seed % 10 === 0 ? "light_cast" : seed % 4 === 0 ? "walk" : "idle",
    moveState: seed % 10 === 0 ? "casting" : seed % 4 === 0 ? "moving" : "idle",
    terrainState: seed % 17 === 0 ? "lava" : seed % 19 === 0 ? "cliff" : "land",
    castingAbilityId,
    invulnerable: seed % 23 === 0,
    jumpZ: seed % 29 === 0 ? 12 : 0,
    jumpStartedInLava: seed % 31 === 0,
    hasSwiftBoots: seed % 37 === 0,
    abilityStates: abilityStates(seed),
    lastProcessedInputSeq: Math.max(0, roundIndex * 60 + id + variant),
    hasProcessedInputSeq: seed % 41 !== 0,
  }
}

/**
 * Builds one deterministic Homing Orb state for a benchmark round.
 *
 * @param id - Entity id.
 * @param roundIndex - Benchmark round.
 * @param variant - Previous/current variant offset.
 * @returns Synthetic Homing Orb state.
 */
function homingOrbState(
  id: number,
  roundIndex: number,
  variant: number,
): SyntheticHomingOrbState {
  const seed = id * 19 + roundIndex * 7 + variant
  const state: Mutable<SyntheticHomingOrbState> = {
    id,
    x: 120 + (id % 32) * 16 + (seed % 4),
    y: 160 + Math.floor(id / 32) * 18 + (seed % 6),
    vx: 80 + (seed % 17),
    vy: -20 + (seed % 13),
    headingRad: ((seed % 360) * Math.PI) / 180,
  }
  if (seed % 5 !== 0) {
    state.targetId = `player-${seed % PLAYER_COUNT}`
  }
  return state
}

/**
 * Prebuilds benchmark state pairs so timing focuses on delta construction.
 *
 * @returns Deterministic player and Homing Orb state pairs.
 */
function buildBenchmarkPairs(): {
  readonly playerPairs: readonly (readonly Pair<SyntheticPlayerState>[])[]
  readonly homingOrbPairs: readonly (readonly Pair<SyntheticHomingOrbState>[])[]
} {
  const playerPairs = Array.from({ length: ROUNDS }, (_, roundIndex) =>
    Array.from({ length: PLAYER_COUNT }, (_, index) => ({
      prev: playerState(index + 1, roundIndex, 0),
      current: playerState(index + 1, roundIndex, index % 3 === 0 ? 0 : 1),
    })),
  )
  const homingOrbPairs = Array.from({ length: ROUNDS }, (_, roundIndex) =>
    Array.from({ length: HOMING_ORB_COUNT }, (_, index) => ({
      prev: homingOrbState(10_000 + index, roundIndex, 0),
      current: homingOrbState(
        10_000 + index,
        roundIndex,
        index % 4 === 0 ? 0 : 1,
      ),
    })),
  )
  return { playerPairs, homingOrbPairs }
}

/**
 * Builds a sparse player delta with the previous spread-heavy shape.
 *
 * @param prev - Previous state.
 * @param current - Current state.
 * @returns Sparse player delta, or null when unchanged.
 */
function buildPlayerDeltaWithSpreads(
  prev: SyntheticPlayerState,
  current: SyntheticPlayerState,
): PlayerDelta | null {
  const delta: PlayerDelta = {
    id: current.id,
    ...(current.x !== prev.x ? { x: current.x } : {}),
    ...(current.y !== prev.y ? { y: current.y } : {}),
    ...(current.vx !== prev.vx ? { vx: current.vx } : {}),
    ...(current.vy !== prev.vy ? { vy: current.vy } : {}),
    ...(current.facingAngle !== prev.facingAngle
      ? { facingAngle: current.facingAngle }
      : {}),
    ...(current.moveFacingAngle !== prev.moveFacingAngle
      ? { moveFacingAngle: current.moveFacingAngle }
      : {}),
    ...(current.health !== prev.health ? { health: current.health } : {}),
    ...(current.lives !== prev.lives ? { lives: current.lives } : {}),
    ...(current.animState !== prev.animState ? { animState: current.animState } : {}),
    ...(current.moveState !== prev.moveState ? { moveState: current.moveState } : {}),
    ...(current.castingAbilityId !== prev.castingAbilityId
      ? { castingAbilityId: current.castingAbilityId }
      : {}),
    ...(current.invulnerable !== prev.invulnerable
      ? { invulnerable: current.invulnerable }
      : {}),
    ...(current.jumpZ !== prev.jumpZ ? { jumpZ: current.jumpZ } : {}),
    ...(current.jumpStartedInLava !== prev.jumpStartedInLava
      ? { jumpStartedInLava: current.jumpStartedInLava }
      : {}),
    ...(current.hasSwiftBoots !== prev.hasSwiftBoots
      ? { hasSwiftBoots: current.hasSwiftBoots }
      : {}),
    ...(current.terrainState !== prev.terrainState
      ? { terrainState: current.terrainState }
      : {}),
    ...(!abilityRuntimeStatesEqual(current.abilityStates, prev.abilityStates)
      ? { abilityStates: current.abilityStates }
      : {}),
    ...(current.hasProcessedInputSeq &&
    current.lastProcessedInputSeq !== prev.lastProcessedInputSeq
      ? { lastProcessedInputSeq: current.lastProcessedInputSeq }
      : {}),
  }
  return playerDeltaChanged(delta) ? delta : null
}

/**
 * Builds a sparse player delta with the PR10 mutable changed-flag shape.
 *
 * @param prev - Previous state.
 * @param current - Current state.
 * @returns Sparse player delta, or null when unchanged.
 */
function buildPlayerDeltaMutable(
  prev: SyntheticPlayerState,
  current: SyntheticPlayerState,
): PlayerDelta | null {
  const delta: Mutable<PlayerDelta> = { id: current.id }
  let changed = false
  if (current.x !== prev.x) {
    delta.x = current.x
    changed = true
  }
  if (current.y !== prev.y) {
    delta.y = current.y
    changed = true
  }
  if (current.vx !== prev.vx) {
    delta.vx = current.vx
    changed = true
  }
  if (current.vy !== prev.vy) {
    delta.vy = current.vy
    changed = true
  }
  if (current.facingAngle !== prev.facingAngle) {
    delta.facingAngle = current.facingAngle
    changed = true
  }
  if (current.moveFacingAngle !== prev.moveFacingAngle) {
    delta.moveFacingAngle = current.moveFacingAngle
    changed = true
  }
  if (current.health !== prev.health) {
    delta.health = current.health
    changed = true
  }
  if (current.lives !== prev.lives) {
    delta.lives = current.lives
    changed = true
  }
  if (current.animState !== prev.animState) {
    delta.animState = current.animState
    changed = true
  }
  if (current.moveState !== prev.moveState) {
    delta.moveState = current.moveState
    changed = true
  }
  if (current.castingAbilityId !== prev.castingAbilityId) {
    delta.castingAbilityId = current.castingAbilityId
    changed = true
  }
  if (current.invulnerable !== prev.invulnerable) {
    delta.invulnerable = current.invulnerable
    changed = true
  }
  if (current.jumpZ !== prev.jumpZ) {
    delta.jumpZ = current.jumpZ
    changed = true
  }
  if (current.jumpStartedInLava !== prev.jumpStartedInLava) {
    delta.jumpStartedInLava = current.jumpStartedInLava
    changed = true
  }
  if (current.hasSwiftBoots !== prev.hasSwiftBoots) {
    delta.hasSwiftBoots = current.hasSwiftBoots
    changed = true
  }
  if (current.terrainState !== prev.terrainState) {
    delta.terrainState = current.terrainState
    changed = true
  }
  if (!abilityRuntimeStatesEqual(current.abilityStates, prev.abilityStates)) {
    delta.abilityStates = current.abilityStates
    changed = true
  }
  if (
    current.hasProcessedInputSeq &&
    current.lastProcessedInputSeq !== prev.lastProcessedInputSeq
  ) {
    delta.lastProcessedInputSeq = current.lastProcessedInputSeq
    changed = true
  }
  return changed ? delta : null
}

/**
 * Builds a sparse Homing Orb delta with the previous Object.keys check.
 *
 * @param prev - Previous state.
 * @param current - Current state.
 * @returns Sparse Homing Orb delta, or null when unchanged.
 */
function buildHomingOrbDeltaWithObjectKeys(
  prev: SyntheticHomingOrbState,
  current: SyntheticHomingOrbState,
): HomingOrbDelta | null {
  const delta: Mutable<HomingOrbDelta> = { id: current.id }
  if (current.x !== prev.x) delta.x = current.x
  if (current.y !== prev.y) delta.y = current.y
  if (current.vx !== prev.vx) delta.vx = current.vx
  if (current.vy !== prev.vy) delta.vy = current.vy
  if (current.headingRad !== prev.headingRad) delta.headingRad = current.headingRad
  if (current.targetId !== prev.targetId) delta.targetId = current.targetId ?? null
  return Object.keys(delta).length > 1 ? delta : null
}

/**
 * Builds a sparse Homing Orb delta with the PR10 mutable changed-flag shape.
 *
 * @param prev - Previous state.
 * @param current - Current state.
 * @returns Sparse Homing Orb delta, or null when unchanged.
 */
function buildHomingOrbDeltaMutable(
  prev: SyntheticHomingOrbState,
  current: SyntheticHomingOrbState,
): HomingOrbDelta | null {
  const delta: Mutable<HomingOrbDelta> = { id: current.id }
  let changed = false
  if (current.x !== prev.x) {
    delta.x = current.x
    changed = true
  }
  if (current.y !== prev.y) {
    delta.y = current.y
    changed = true
  }
  if (current.vx !== prev.vx) {
    delta.vx = current.vx
    changed = true
  }
  if (current.vy !== prev.vy) {
    delta.vy = current.vy
    changed = true
  }
  if (current.headingRad !== prev.headingRad) {
    delta.headingRad = current.headingRad
    changed = true
  }
  if (current.targetId !== prev.targetId) {
    delta.targetId = current.targetId ?? null
    changed = true
  }
  return changed ? delta : null
}

/**
 * Measures one delta builder pair over all prebuilt frames.
 *
 * @param playerPairs - Player state pairs by round.
 * @param homingOrbPairs - Homing Orb state pairs by round.
 * @param playerBuilder - Player delta builder under test.
 * @param homingOrbBuilder - Homing Orb delta builder under test.
 * @param estimatedTemporaryObjects - Static temporary-object estimate for the path.
 * @returns Benchmark metrics.
 */
function measureBuilders(
  playerPairs: readonly (readonly Pair<SyntheticPlayerState>[])[],
  homingOrbPairs: readonly (readonly Pair<SyntheticHomingOrbState>[])[],
  playerBuilder: PlayerDeltaBuilder,
  homingOrbBuilder: HomingOrbDeltaBuilder,
  estimatedTemporaryObjects: number,
): BenchmarkMetrics {
  const samples: number[] = []
  let totalMs = 0
  let deltaCount = 0
  let checksum = 0

  for (let roundIndex = 0; roundIndex < ROUNDS; roundIndex += 1) {
    const startedAt = performance.now()
    for (const pair of playerPairs[roundIndex] ?? []) {
      const delta = playerBuilder(pair.prev, pair.current)
      if (!delta) continue
      deltaCount += 1
      checksum += checksumPlayerDelta(delta)
    }
    for (const pair of homingOrbPairs[roundIndex] ?? []) {
      const delta = homingOrbBuilder(pair.prev, pair.current)
      if (!delta) continue
      deltaCount += 1
      checksum += checksumHomingOrbDelta(delta)
    }
    const elapsedMs = performance.now() - startedAt
    samples.push(elapsedMs)
    totalMs += elapsedMs
  }

  return {
    totalMs: round(totalMs),
    p95Ms: percentile(samples, 95),
    deltaCount,
    checksum,
    estimatedTemporaryObjects,
  }
}

/**
 * Checks whether a spread-built player delta contains any sparse fields.
 *
 * @param delta - Delta payload.
 * @returns True when at least one optional field is present.
 */
function playerDeltaChanged(delta: PlayerDelta): boolean {
  return (
    delta.x !== undefined ||
    delta.y !== undefined ||
    delta.vx !== undefined ||
    delta.vy !== undefined ||
    delta.facingAngle !== undefined ||
    delta.moveFacingAngle !== undefined ||
    delta.health !== undefined ||
    delta.lives !== undefined ||
    delta.animState !== undefined ||
    delta.moveState !== undefined ||
    delta.terrainState !== undefined ||
    delta.castingAbilityId !== undefined ||
    delta.invulnerable !== undefined ||
    delta.jumpZ !== undefined ||
    delta.jumpStartedInLava !== undefined ||
    delta.hasSwiftBoots !== undefined ||
    delta.abilityStates !== undefined ||
    delta.lastProcessedInputSeq !== undefined
  )
}

/**
 * Compares two ability runtime state maps by value.
 *
 * @param a - First runtime state map.
 * @param b - Second runtime state map.
 * @returns True when all fields match.
 */
function abilityRuntimeStatesEqual(
  a: AbilityRuntimeStates,
  b: AbilityRuntimeStates,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const left = a[key]
    const right = b[key]
    if (!left || !right) return false
    if (left.cooldownEndsAtServerTimeMs !== right.cooldownEndsAtServerTimeMs) return false
    if (left.cooldownDurationMs !== right.cooldownDurationMs) return false
    if (left.charges !== right.charges) return false
    if (left.maxCharges !== right.maxCharges) return false
    if (left.rechargeEndsAtServerTimeMs !== right.rechargeEndsAtServerTimeMs) return false
    if (left.rechargeDurationMs !== right.rechargeDurationMs) return false
  }
  return true
}

/**
 * Computes a stable checksum for sparse player delta parity.
 *
 * @param delta - Player delta.
 * @returns Numeric checksum.
 */
function checksumPlayerDelta(delta: PlayerDelta): number {
  let checksum = delta.id * 31
  checksum += maybeNumber(delta.x, 3)
  checksum += maybeNumber(delta.y, 5)
  checksum += maybeNumber(delta.vx, 7)
  checksum += maybeNumber(delta.vy, 11)
  checksum += maybeNumber(delta.facingAngle, 13)
  checksum += maybeNumber(delta.moveFacingAngle, 17)
  checksum += maybeNumber(delta.health, 19)
  checksum += maybeNumber(delta.lives, 23)
  checksum += maybeString(delta.animState, 29)
  checksum += maybeString(delta.moveState, 31)
  checksum += maybeString(delta.terrainState, 37)
  checksum += "castingAbilityId" in delta
    ? maybeString(delta.castingAbilityId, 41) + 43
    : 0
  checksum += delta.invulnerable === undefined ? 0 : delta.invulnerable ? 47 : 53
  checksum += maybeNumber(delta.jumpZ, 59)
  checksum += delta.jumpStartedInLava === undefined
    ? 0
    : delta.jumpStartedInLava
      ? 61
      : 67
  checksum += delta.hasSwiftBoots === undefined ? 0 : delta.hasSwiftBoots ? 71 : 73
  checksum += delta.abilityStates ? checksumAbilityStates(delta.abilityStates) : 0
  checksum += maybeNumber(delta.lastProcessedInputSeq, 79)
  return checksum
}

/**
 * Computes a stable checksum for sparse Homing Orb delta parity.
 *
 * @param delta - Homing Orb delta.
 * @returns Numeric checksum.
 */
function checksumHomingOrbDelta(delta: HomingOrbDelta): number {
  let checksum = delta.id * 83
  checksum += maybeNumber(delta.x, 89)
  checksum += maybeNumber(delta.y, 97)
  checksum += maybeNumber(delta.vx, 101)
  checksum += maybeNumber(delta.vy, 103)
  checksum += maybeNumber(delta.headingRad, 107)
  checksum += "targetId" in delta ? maybeString(delta.targetId, 109) + 113 : 0
  return checksum
}

/**
 * Computes a stable checksum for ability runtime state maps.
 *
 * @param states - Ability runtime states.
 * @returns Numeric checksum.
 */
function checksumAbilityStates(states: AbilityRuntimeStates): number {
  let checksum = 0
  for (const key of Object.keys(states).sort()) {
    const state = states[key]
    if (!state) continue
    checksum += maybeString(key, 127)
    checksum += maybeNumber(state.cooldownEndsAtServerTimeMs ?? undefined, 131)
    checksum += maybeNumber(state.cooldownDurationMs ?? undefined, 137)
    checksum += maybeNumber(state.charges ?? undefined, 139)
    checksum += maybeNumber(state.maxCharges ?? undefined, 149)
    checksum += maybeNumber(state.rechargeEndsAtServerTimeMs ?? undefined, 151)
    checksum += maybeNumber(state.rechargeDurationMs ?? undefined, 157)
  }
  return checksum
}

/**
 * Adds one optional number to a checksum.
 *
 * @param value - Optional numeric value.
 * @param factor - Stable multiplier.
 * @returns Checksum contribution.
 */
function maybeNumber(value: number | undefined, factor: number): number {
  return value === undefined ? 0 : Math.round(value * 1_000) * factor
}

/**
 * Adds one optional string or null to a checksum.
 *
 * @param value - Optional string or null.
 * @param factor - Stable multiplier.
 * @returns Checksum contribution.
 */
function maybeString(value: string | null | undefined, factor: number): number {
  if (value === undefined) return 0
  if (value === null) return factor * 17
  let checksum = 0
  for (let index = 0; index < value.length; index += 1) {
    checksum += value.charCodeAt(index) * factor
  }
  return checksum
}

/**
 * Computes a rounded percentile from benchmark samples.
 *
 * @param samples - Timing samples in milliseconds.
 * @param percentileValue - Percentile value in the range 0-100.
 * @returns Rounded percentile in milliseconds.
 */
function percentile(samples: readonly number[], percentileValue: number): number {
  const sorted = [...samples].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  )
  return round(sorted[index] ?? 0)
}

/**
 * Rounds timings to stable JSON precision.
 *
 * @param value - Raw timing value.
 * @returns Rounded timing.
 */
function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

/**
 * Writes the benchmark report to the ignored perf-load results directory.
 *
 * @param report - Benchmark report payload.
 * @returns Absolute report path.
 */
function writeBenchmarkReport(report: DeltaAllocationReport): string {
  const outDir = join(process.cwd(), "test-results", "perf-load")
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, `delta-allocation-${report.runId}.json`)
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  return path
}

describe("delta allocation benchmark", () => {
  it("preserves sparse payload parity while removing temporary delta builders", () => {
    const runId =
      sanitizePerfRunId(process.env.WW_PERF_RUN_ID) ?? String(Date.now())
    const { playerPairs, homingOrbPairs } = buildBenchmarkPairs()
    const baselineSpreadObjectKeys = measureBuilders(
      playerPairs,
      homingOrbPairs,
      buildPlayerDeltaWithSpreads,
      buildHomingOrbDeltaWithObjectKeys,
      ROUNDS * ((PLAYER_COUNT * PLAYER_SPARSE_SPREAD_BRANCHES) + HOMING_ORB_COUNT),
    )
    const mutableChangedFlag = measureBuilders(
      playerPairs,
      homingOrbPairs,
      buildPlayerDeltaMutable,
      buildHomingOrbDeltaMutable,
      0,
    )
    const report: DeltaAllocationReport = {
      runId,
      playerCount: PLAYER_COUNT,
      homingOrbCount: HOMING_ORB_COUNT,
      rounds: ROUNDS,
      baselineSpreadObjectKeys,
      mutableChangedFlag,
    }

    writeBenchmarkReport(report)

    expect(mutableChangedFlag.deltaCount).toBe(baselineSpreadObjectKeys.deltaCount)
    expect(mutableChangedFlag.checksum).toBe(baselineSpreadObjectKeys.checksum)
    expect(mutableChangedFlag.estimatedTemporaryObjects).toBe(0)
    expect(baselineSpreadObjectKeys.estimatedTemporaryObjects).toBeGreaterThan(0)
  })
})
