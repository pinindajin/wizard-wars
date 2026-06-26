import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { performance } from "node:perf_hooks"

import { addComponent, addEntity, createWorld, hasComponent, query } from "bitecs"
import { describe, expect, it } from "vitest"

import { createCommandBuffer } from "@/server/game/commandBuffer"
import {
  DeadTag,
  DyingTag,
  InvulnerableTag,
  PlayerTag,
  Position,
  SpectatorTag,
} from "@/server/game/components"
import {
  getDamageablePlayerTargets,
  rebuildDamageablePlayerTargets,
  resetDamageablePlayerTargetCaches,
  type DamageablePlayerTarget,
} from "@/server/game/damageablePlayerCache"
import { sanitizePerfRunId } from "@/server/game/performanceConfig"
import type { SimCtx } from "@/server/game/simulation"
import {
  characterHitboxForCenter,
  circleIntersectsRect,
} from "@/shared/collision/characterHitbox"

const PLAYER_COUNT = 96
const CONSUMERS_PER_TICK = 24
const ROUNDS = 64
const PROBE_RADIUS_PX = 24

type CacheBenchmarkMetrics = {
  readonly totalMs: number
  readonly p95Ms: number
  readonly checksum: number
  readonly targetBuilds: number
}

type CacheBenchmarkReport = {
  readonly runId: string
  readonly playerCount: number
  readonly consumersPerTick: number
  readonly rounds: number
  readonly uncached: CacheBenchmarkMetrics
  readonly cached: CacheBenchmarkMetrics
}

function emptyCtx(overrides: Partial<SimCtx> = {}): SimCtx {
  return {
    world: createWorld(),
    currentTick: 1,
    serverTimeMs: 1_000,
    playerEntityMap: new Map(),
    entityPlayerMap: new Map(),
    playerUsernameMap: new Map(),
    entityUsernameMap: new Map(),
    playerHeroIdMap: new Map(),
    fireballOwnerMap: new Map(),
    fireballCreatedAtTickMap: new Map(),
    homingOrbOwnerMap: new Map(),
    homingOrbTargetPlayerMap: new Map(),
    homingOrbCastTargetPlayerMap: new Map(),
    inputMap: new Map(),
    lastProcessedInputSeqByPlayer: new Map(),
    commandBuffer: createCommandBuffer(),
    matchStartedAtMs: 0,
    damageRequests: [],
    deathEvents: [],
    pendingLightningBolts: [],
    playerDeaths: [],
    playerRespawns: [],
    fireballLaunches: [],
    fireballImpacts: [],
    fireballRemovedIds: [],
    homingOrbLaunches: [],
    homingOrbImpacts: [],
    homingOrbRemovedIds: [],
    lightningBolts: [],
    primaryMeleeAttacks: [],
    combatTelegraphStarts: [],
    combatTelegraphEnds: [],
    damageFloats: [],
    goldUpdates: [],
    abilitySfxEvents: [],
    matchEnded: null,
    hostEndSignal: false,
    prevPlayerStates: new Map(),
    prevFireballStates: new Map(),
    prevHomingOrbStates: new Map(),
    killStats: new Map(),
    activeMeleeAttacks: new Map(),
    activeCombatTelegraphs: new Map(),
    invulnerableExpiresAtTickByEntity: new Map(),
    playerDeltas: [],
    fireballDeltas: [],
    homingOrbDeltas: [],
    ...overrides,
  }
}

/**
 * Creates a deterministic mixed player population for cache benchmarking.
 *
 * @returns Simulation context with mapped, unmapped, and filtered players.
 */
function seededCtx(): SimCtx {
  const ctx = emptyCtx()
  for (let index = 0; index < PLAYER_COUNT; index += 1) {
    const eid = addEntity(ctx.world)
    addComponent(ctx.world, eid, PlayerTag)
    addComponent(ctx.world, eid, Position)
    Position.x[eid] = 64 + (index % 12) * 36
    Position.y[eid] = 96 + Math.floor(index / 12) * 42
    if (index % 7 !== 0) ctx.entityPlayerMap.set(eid, `player-${index}`)
    if (index % 31 === 0) addComponent(ctx.world, eid, DeadTag)
    if (index % 37 === 0) addComponent(ctx.world, eid, DyingTag)
    if (index % 41 === 0) addComponent(ctx.world, eid, SpectatorTag)
    if (index % 43 === 0) addComponent(ctx.world, eid, InvulnerableTag)
  }
  return ctx
}

/**
 * Builds damageable target entries without using the shared cache.
 *
 * @param ctx - Simulation context to scan.
 * @returns Fresh damageable target entries in query order.
 */
function buildTargetsUncached(ctx: SimCtx): DamageablePlayerTarget[] {
  const targets: DamageablePlayerTarget[] = []
  for (const eid of query(ctx.world, [PlayerTag])) {
    if (hasComponent(ctx.world, eid, DyingTag)) continue
    if (hasComponent(ctx.world, eid, DeadTag)) continue
    if (hasComponent(ctx.world, eid, SpectatorTag)) continue
    if (hasComponent(ctx.world, eid, InvulnerableTag)) continue

    const x = Position.x[eid]
    const y = Position.y[eid]
    targets.push({
      eid,
      userId: ctx.entityPlayerMap.get(eid),
      x,
      y,
      hitbox: characterHitboxForCenter(x, y),
    })
  }
  return targets
}

/**
 * Measures repeated target builds that model pre-cache combat consumers.
 *
 * @param ctx - Benchmark simulation context.
 * @returns Timing and parity metrics.
 */
function measureUncached(ctx: SimCtx): CacheBenchmarkMetrics {
  const samples: number[] = []
  let totalMs = 0
  let checksum = 0
  let targetBuilds = 0
  for (let roundIndex = 0; roundIndex < ROUNDS; roundIndex += 1) {
    const startedAt = performance.now()
    for (let consumerIndex = 0; consumerIndex < CONSUMERS_PER_TICK; consumerIndex += 1) {
      const targets = buildTargetsUncached(ctx)
      targetBuilds += 1
      checksum += scanTargets(targets, roundIndex, consumerIndex)
    }
    const elapsedMs = performance.now() - startedAt
    samples.push(elapsedMs)
    totalMs += elapsedMs
  }
  return { totalMs: round(totalMs), p95Ms: percentile(samples, 95), checksum, targetBuilds }
}

/**
 * Measures one target rebuild per tick with repeated cache consumers.
 *
 * @param ctx - Benchmark simulation context.
 * @returns Timing and parity metrics.
 */
function measureCached(ctx: SimCtx): CacheBenchmarkMetrics {
  const samples: number[] = []
  let totalMs = 0
  let checksum = 0
  let targetBuilds = 0
  for (let roundIndex = 0; roundIndex < ROUNDS; roundIndex += 1) {
    const startedAt = performance.now()
    resetDamageablePlayerTargetCaches(ctx)
    rebuildDamageablePlayerTargets(ctx)
    targetBuilds += 1
    for (let consumerIndex = 0; consumerIndex < CONSUMERS_PER_TICK; consumerIndex += 1) {
      checksum += scanTargets(getDamageablePlayerTargets(ctx), roundIndex, consumerIndex)
    }
    const elapsedMs = performance.now() - startedAt
    samples.push(elapsedMs)
    totalMs += elapsedMs
  }
  return { totalMs: round(totalMs), p95Ms: percentile(samples, 95), checksum, targetBuilds }
}

/**
 * Applies deterministic hit checks across a target list.
 *
 * @param targets - Damageable targets to scan.
 * @param roundIndex - Benchmark round index.
 * @param consumerIndex - Simulated consumer index within the tick.
 * @returns Stable checksum for parity comparisons.
 */
function scanTargets(
  targets: readonly DamageablePlayerTarget[],
  roundIndex: number,
  consumerIndex: number,
): number {
  const probeX = 64 + ((roundIndex + consumerIndex) % 12) * 36
  const probeY = 96 + Math.floor(((roundIndex * 3) + consumerIndex) % 8) * 42
  let checksum = 0
  for (const target of targets) {
    if (!circleIntersectsRect(probeX, probeY, PROBE_RADIUS_PX, target.hitbox)) continue
    checksum += target.eid + (target.userId === undefined ? 17 : target.userId.length)
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
 * Rounds milliseconds for stable JSON output.
 *
 * @param value - Numeric value to round.
 * @returns Value rounded to microsecond precision.
 */
function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

/**
 * Writes the benchmark report to the ignored perf-load results directory.
 *
 * @param report - Report payload.
 * @returns Absolute report path.
 */
function writeBenchmarkReport(report: CacheBenchmarkReport): string {
  const outDir = join(process.cwd(), "test-results", "perf-load")
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, `damageable-player-cache-${report.runId}.json`)
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  return path
}

describe("damageable player cache benchmark", () => {
  it("reuses one damageable target build across combat consumers", () => {
    const runId =
      sanitizePerfRunId(process.env.WW_PERF_RUN_ID) ?? String(Date.now())
    const uncached = measureUncached(seededCtx())
    const cached = measureCached(seededCtx())
    const report: CacheBenchmarkReport = {
      runId,
      playerCount: PLAYER_COUNT,
      consumersPerTick: CONSUMERS_PER_TICK,
      rounds: ROUNDS,
      uncached,
      cached,
    }

    writeBenchmarkReport(report)

    expect(cached.checksum).toBe(uncached.checksum)
    expect(cached.targetBuilds).toBe(ROUNDS)
    expect(uncached.targetBuilds).toBe(ROUNDS * CONSUMERS_PER_TICK)
    expect(cached.totalMs).toBeLessThanOrEqual(
      uncached.totalMs + Math.max(1, uncached.totalMs * 0.75),
    )
  })
})
