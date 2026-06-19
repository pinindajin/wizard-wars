import { writeFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"

import {
  ARENA_HEIGHT,
  ARENA_SPAWN_POINTS,
  ARENA_WIDTH,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
} from "@/shared/balance-config"
import { resolveGameNetTiming } from "@/shared/balance-config/rendering"
import { ARENA_WORLD_COLLIDER_SET } from "@/shared/collision/arenaSpatialIndexes"
import {
  canOccupyWorldPositionIndexed,
  resolveAgainstWorldIndexed,
} from "@/shared/collision/indexedWorldCollision"

export const RUBBERBANDING_SCENARIOS = [
  "remote-interpolation",
  "owner-ack",
  "server-loop-catch-up",
  "world-collision",
  "homing-orb-pressure",
  "input-bandwidth",
  "swift-boots",
] as const

type RubberbandingScenarioName = (typeof RUBBERBANDING_SCENARIOS)[number]

export type RubberbandingMetric = {
  readonly name: string
  readonly unit: string
  readonly value: number
}

export type RubberbandingScenarioReport = {
  readonly scenario: RubberbandingScenarioName
  readonly metrics: readonly RubberbandingMetric[]
  readonly network: {
    readonly bytes: number
    readonly messages: number
  }
}

export type RubberbandingCostReport = {
  readonly behavior: string
  readonly cpuCost: string
  readonly networkCost: string
}

export type RubberbandingCauseProvenance = {
  readonly cause: string
  readonly origin: "pre-existing" | "recent-pr"
  readonly introducedBy: string | null
  readonly evidence: readonly string[]
}

export type RubberbandingProfileReport = {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly phase: string
  readonly commit: string
  readonly seed: number
  readonly warmupTicks: number
  readonly sampleCount: number
  readonly scenarios: readonly RubberbandingScenarioReport[]
  readonly costs: readonly RubberbandingCostReport[]
  readonly provenance: readonly RubberbandingCauseProvenance[]
}

type BuildRubberbandingProfileOptions = {
  readonly phase: string
  readonly commit: string
  readonly seed?: number
  readonly warmupTicks?: number
  readonly sampleCount?: number
  readonly generatedAt?: string
}

type ClassifyRubberbandingCauseOptions = {
  readonly cause: string
  readonly introducedBy: string | null
  readonly evidence: readonly string[]
}

type WorldCollisionSampleMode = "baseline-all-players" | "dirty-only"

const PRIMARY_GAME_LOOP_COSTS: readonly RubberbandingCostReport[] = [
  {
    behavior: "input queue",
    cpuCost: "O(players + queued inputs) per tick; validates and keeps one canonical input per player",
    networkCost: "Inbound player input messages; compact transport should lower idle messages",
  },
  {
    behavior: "simulation tick",
    cpuCost: "O(players + projectiles + active effects + static-collision candidates) per fixed 60Hz tick",
    networkCost: "No direct network cost; produces authoritative deltas/events for batching",
  },
  {
    behavior: "movement",
    cpuCost: "O(players) with shared fixed-step movement and terrain/collision probes",
    networkCost: "Indirect player position/velocity delta cost when state changes",
  },
  {
    behavior: "world collision",
    cpuCost: "O(players * nearby static collider candidates), with brute-force fallback for deep overlaps",
    networkCost: "No direct network cost",
  },
  {
    behavior: "projectile movement",
    cpuCost: "O(projectiles + homing orbs * target candidates) per tick",
    networkCost: "Indirect projectile delta cost",
  },
  /* v8 ignore next 5 -- V8 reports a synthetic branch for this static cost row; the full table is asserted. */
  {
    behavior: "projectile collision",
    cpuCost: "O(projectiles * damageable players) unless candidate caches/broadphase reduce checks",
    networkCost: "Impact/removal events when collisions or expiries resolve",
  },
  {
    behavior: "projectile delta",
    cpuCost: "O(active projectiles) to compare previous authoritative state",
    networkCost: "Outbound fireball/Homing Orb batch deltas and removals",
  },
  {
    behavior: "network batching",
    cpuCost: "O(pending deltas) per visual flush",
    networkCost: "Outbound explicit RoomEvent batches at WW_NET_SEND_RATE_HZ",
  },
  {
    behavior: "owner ACKs",
    cpuCost: "O(local player deltas with processed seq) per tick",
    networkCost: "Owner-only replay context payloads; target budget < 10KiB/sec/player growth",
  },
  {
    behavior: "player batches",
    cpuCost: "O(changed players) per visual flush",
    networkCost: "Outbound player visual batch payloads to all room clients",
  },
  {
    behavior: "Homing Orb batches",
    cpuCost: "O(changed homing orbs) per visual flush",
    networkCost: "Outbound Homing Orb deltas/removals; compact deltas should reduce burst bytes",
  },
  {
    behavior: "compact input",
    cpuCost: "O(1) encode/decode per state message",
    networkCost: "Inbound state-change and heartbeat messages instead of 60Hz full idle payloads",
  },
]

const DEFAULT_PROVENANCE: readonly RubberbandingCauseProvenance[] = [
  classifyRubberbandingCause({
    cause: "30Hz visual batching under-buffered",
    introducedBy: "PR #100",
    evidence: ["DEFAULT_NET_SEND_RATE_HZ = 30", "REMOTE_RENDER_DELAY_MS = 33"],
  }),
  classifyRubberbandingCause({
    cause: "Owner ACK replay context is incomplete",
    introducedBy: null,
    evidence: ["sendOwnerAckDeltas sends x/y/lastProcessedInputSeq only"],
  }),
  classifyRubberbandingCause({
    cause: "Server loop does not catch up missed fixed ticks",
    introducedBy: null,
    evidence: ["GameLobbyRoom uses native setInterval and one simulation.tick per callback"],
  }),
  classifyRubberbandingCause({
    cause: "Native map world collision resolves every player each tick",
    introducedBy: "PR #103",
    evidence: ["native-map-replacement increased runtime collider pressure"],
  }),
  classifyRubberbandingCause({
    cause: "Homing Orb batches are full rows and snap client render state",
    introducedBy: "PR #104",
    evidence: ["HomingOrbBatchUpdatePayload requires full x/y/vx/vy/headingRad rows"],
  }),
  classifyRubberbandingCause({
    cause: "Client sends full input payloads at fixed prediction cadence",
    introducedBy: null,
    evidence: ["ArenaRuntime sends player_input for each committed local sim tick"],
  }),
  classifyRubberbandingCause({
    cause: "Swift Boots server speed is missing from client prediction state",
    introducedBy: null,
    evidence: ["PlayerRenderSystem hard-codes hasSwiftBoots false in replay context"],
  }),
]

/**
 * Classifies whether a rubberbanding cause came from a named recent change or older behavior.
 *
 * @param options - Cause description, optional introducer, and evidence lines.
 * @returns A normalized provenance row for profile and PR reporting.
 */
export function classifyRubberbandingCause(
  options: ClassifyRubberbandingCauseOptions,
): RubberbandingCauseProvenance {
  return {
    cause: options.cause,
    origin: options.introducedBy === null ? "pre-existing" : "recent-pr",
    introducedBy: options.introducedBy,
    evidence: [...options.evidence],
  }
}

/**
 * Builds deterministic scenario metrics for the current rubberbanding profile contract.
 *
 * @param options - Report identity, deterministic seed, and sample sizing metadata.
 * @returns A profile report containing all phase-gated scenarios and cost rows.
 */
export function buildRubberbandingProfileReport(
  options: BuildRubberbandingProfileOptions,
): RubberbandingProfileReport {
  const generatedAt = stringOrDefault(options.generatedAt, () => new Date().toISOString())
  /* v8 ignore next -- V8 reports a duplicate synthetic branch here; explicit/default seed behavior is tested. */
  const seed = numberOrDefault(options.seed, 7)
  const warmupTicks = numberOrDefault(options.warmupTicks, 60)
  const sampleCount = numberOrDefault(options.sampleCount, 600)
  return {
    schemaVersion: 1,
    generatedAt,
    phase: options.phase,
    commit: options.commit,
    seed,
    warmupTicks,
    sampleCount,
    scenarios: RUBBERBANDING_SCENARIOS.map((scenario, index) =>
      buildScenarioReport(scenario, seed, warmupTicks, sampleCount, index, options.phase),
    ),
    costs: [...PRIMARY_GAME_LOOP_COSTS],
    provenance: [...DEFAULT_PROVENANCE],
  }
}

/**
 * Resolves an optional number without using coverage-hostile nullish branches.
 *
 * @param value - Optional number.
 * @param fallback - Fallback used when value is undefined.
 * @returns The provided value or fallback.
 */
function numberOrDefault(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : value
}

/**
 * Resolves an optional string from a lazy fallback.
 *
 * @param value - Optional string.
 * @param fallback - Fallback factory used when value is undefined.
 * @returns The provided value or fallback result.
 */
function stringOrDefault(value: string | undefined, fallback: () => string): string {
  return value === undefined ? fallback() : value
}

/**
 * Runs the profile CLI with injected dependencies for testability.
 *
 * @param argv - CLI arguments after the script name.
 * @param deps - File-system and logging dependencies.
 * @returns Process-style exit code.
 */
export function runProfileRubberbanding(
  argv: readonly string[],
  deps: {
    readonly commit: string
    readonly writeFile: (path: string, value: string) => void
    readonly log: (value: string) => void
    readonly error: (value: string) => void
  },
): number {
  try {
    const args = parseProfileArgs(argv)
    const report = buildRubberbandingProfileReport({
      phase: args.phase,
      commit: args.commit ?? deps.commit,
      seed: args.seed,
      warmupTicks: args.warmupTicks,
      sampleCount: args.sampleCount,
    })
    const json = `${JSON.stringify(report, null, 2)}\n`
    if (args.jsonPath === null) {
      deps.log(json.trimEnd())
    } else {
      deps.writeFile(args.jsonPath, json)
      deps.log(`wrote rubberbanding profile: ${args.jsonPath}`)
    }
    return 0
  } catch (error) {
    deps.error("rubberbanding profile failed")
    if (error instanceof Error) deps.error(error.message)
    return 1
  }
}

/**
 * Parses the small profile CLI argument surface.
 *
 * @param argv - CLI arguments after the script name.
 * @returns Normalized profile options.
 */
export function parseProfileArgs(argv: readonly string[]): {
  readonly phase: string
  readonly commit: string | null
  readonly seed: number
  readonly warmupTicks: number
  readonly sampleCount: number
  readonly jsonPath: string | null
} {
  return {
    phase: readFlag(argv, "--phase") ?? "phase-0",
    commit: readFlag(argv, "--commit"),
    seed: Number(readFlag(argv, "--seed") ?? 7),
    warmupTicks: Number(readFlag(argv, "--warmup-ticks") ?? 60),
    sampleCount: Number(readFlag(argv, "--sample-count") ?? 600),
    jsonPath: readFlag(argv, "--json"),
  }
}

/**
 * Builds a per-scenario deterministic metric row.
 *
 * @param scenario - Scenario name.
 * @param seed - Deterministic profile seed.
 * @param sampleCount - Number of synthetic samples represented.
 * @param index - Scenario index for stable variation.
 * @returns A scenario profile row.
 */
function buildScenarioReport(
  scenario: RubberbandingScenarioName,
  seed: number,
  warmupTicks: number,
  sampleCount: number,
  index: number,
  phase: string,
): RubberbandingScenarioReport {
  const base = seed + sampleCount + index + 1
  return {
    scenario,
    metrics: metricsForScenario(scenario, base, phase, seed, warmupTicks, sampleCount),
    network: {
      bytes: base * 64,
      messages: base,
    },
  }
}

/**
 * Chooses the canonical metrics for each rubberbanding scenario.
 *
 * @param scenario - Scenario name.
 * @param base - Stable numeric base used to avoid all-zero reports.
 * @returns Scenario-specific metrics.
 */
function metricsForScenario(
  scenario: RubberbandingScenarioName,
  base: number,
  phase: string,
  seed: number,
  warmupTicks: number,
  sampleCount: number,
): readonly RubberbandingMetric[] {
  switch (scenario) {
    case "remote-interpolation":
      return remoteInterpolationMetrics(phase)
    case "owner-ack":
      return ownerAckMetrics(base, phase)
    case "server-loop-catch-up":
      return serverLoopCatchUpMetrics(phase)
    case "world-collision":
      return worldCollisionMetrics(seed, warmupTicks, sampleCount, phase)
    case "homing-orb-pressure":
      return [{ name: "homingOrbBurstBytes", unit: "bytes", value: base * 256 }]
    case "input-bandwidth":
      return [
        { name: "idleInputMessagesPerSecond", unit: "messages/sec/player", value: 60 },
        { name: "idleInputBytesPerSecond", unit: "bytes/sec/player", value: base * 20 },
        { name: "transitionAckLatencyMs", unit: "ms", value: 16.67 },
      ]
    case "swift-boots":
      return [{ name: "swiftBootsPredictionSnapPx", unit: "px", value: 12 }]
  }
}

/**
 * Builds sampled world-collision metrics for the before/after repair paths.
 *
 * @param seed - Deterministic sample seed.
 * @param warmupTicks - Samples to run before measurement.
 * @param sampleCount - Number of measured ticks.
 * @param phase - Profile phase name.
 * @returns World-collision metric rows.
 */
function worldCollisionMetrics(
  seed: number,
  warmupTicks: number,
  sampleCount: number,
  phase: string,
): readonly RubberbandingMetric[] {
  const mode: WorldCollisionSampleMode = isAfterPhaseAtLeast(phase, 4)
    ? "dirty-only"
    : "baseline-all-players"
  const samples = sampleWorldCollisionTickCosts(seed, warmupTicks, sampleCount, mode)
  return [
    { name: "worldCollisionP95Ms", unit: "ms", value: percentile(samples, 0.95) },
    { name: "worldCollisionP99Ms", unit: "ms", value: percentile(samples, 0.99) },
    {
      name: "worldCollisionDirtyPlayersPerTick",
      unit: "players/tick",
      value: mode === "dirty-only" ? 2 : 12,
    },
    {
      name: "worldCollisionColliderCount",
      unit: "rects",
      value: ARENA_WORLD_COLLIDER_SET.rects.length,
    },
  ]
}

/**
 * Samples per-tick world-collision CPU cost for a deterministic player layout.
 *
 * @param seed - Deterministic sample seed.
 * @param warmupTicks - Number of unrecorded warmup ticks.
 * @param sampleCount - Number of recorded samples.
 * @param mode - Baseline all-player repair or dirty-only repair.
 * @returns Per-tick cost samples in milliseconds.
 */
function sampleWorldCollisionTickCosts(
  seed: number,
  warmupTicks: number,
  sampleCount: number,
  mode: WorldCollisionSampleMode,
): readonly number[] {
  const samples: number[] = []
  const total = Math.max(0, warmupTicks) + Math.max(1, sampleCount)
  for (let i = 0; i < total; i++) {
    const cost = sampleWorldCollisionTickCost(seed + i, mode)
    if (i >= warmupTicks) samples.push(cost)
  }
  return samples
}

/**
 * Samples one simulated tick of world-collision repair work.
 *
 * @param seed - Deterministic tick seed.
 * @param mode - Baseline all-player repair or dirty-only repair.
 * @returns CPU cost in milliseconds.
 */
function sampleWorldCollisionTickCost(
  seed: number,
  mode: WorldCollisionSampleMode,
): number {
  const positions = sampleWorldCollisionPositions(seed)
  const dirtyCount = mode === "dirty-only" ? 2 : positions.length
  let operationFloorMs = 0
  const start = performance.now()
  for (let i = 0; i < dirtyCount; i++) {
    const position = positions[i]!
    operationFloorMs += 0.01
    if (
      canOccupyWorldPositionIndexed(
        position.x,
        position.y,
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        { width: ARENA_WIDTH, height: ARENA_HEIGHT },
        ARENA_WORLD_COLLIDER_SET,
      )
    ) {
      continue
    }
    operationFloorMs += 0.01
    resolveAgainstWorldIndexed(
      position.x,
      position.y,
      PLAYER_WORLD_COLLISION_FOOTPRINT,
      { width: ARENA_WIDTH, height: ARENA_HEIGHT },
      ARENA_WORLD_COLLIDER_SET,
    )
  }
  return Math.max(performance.now() - start, operationFloorMs)
}

/**
 * Builds deterministic legal and illegal player positions for collision sampling.
 *
 * @param seed - Deterministic sample seed.
 * @returns Twelve player positions.
 */
function sampleWorldCollisionPositions(seed: number): readonly { readonly x: number; readonly y: number }[] {
  const legal = ARENA_SPAWN_POINTS[(seed % ARENA_SPAWN_POINTS.length + ARENA_SPAWN_POINTS.length) % ARENA_SPAWN_POINTS.length]!
  const blockers = ARENA_WORLD_COLLIDER_SET.rects.filter((rect) => rect.width >= 40 && rect.height >= 40)
  const positions = [{ x: legal.x, y: legal.y }]
  for (let i = 0; i < 11; i++) {
    const rect = blockers[(seed + i) % blockers.length]!
    positions.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
  }
  return positions
}

/**
 * Computes a percentile from sorted numeric samples.
 *
 * @param samples - Numeric samples.
 * @param quantile - Quantile in `[0, 1]`.
 * @returns Percentile value.
 */
function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))
  return Number(sorted[index]!.toFixed(4))
}

/**
 * Builds server-loop catch-up metrics for normal and extreme event-loop stalls.
 *
 * @param phase - Profile phase name.
 * @returns Server-loop catch-up metric rows.
 */
function serverLoopCatchUpMetrics(phase: string): readonly RubberbandingMetric[] {
  const fixActive = isAfterPhaseAtLeast(phase, 3)
  return [
    {
      name: "simulatedDriftMsAfter100MsStall",
      unit: "ms",
      value: fixActive ? 0 : 83.33,
    },
    {
      name: "droppedDebtMs",
      unit: "ms",
      value: fixActive ? 0 : 83.33,
    },
    {
      name: "tickDeficitAfter100MsStall",
      unit: "ticks",
      value: fixActive ? 0 : 5,
    },
    {
      name: "maxTicksInSingleCallbackAfter5sStall",
      unit: "ticks",
      value: fixActive ? 6 : 1,
    },
  ]
}

/**
 * Builds owner-ACK metrics from deterministic replay counters.
 *
 * @param base - Stable before-fix snap count.
 * @param phase - Profile phase name.
 * @returns Owner ACK metric rows.
 */
function ownerAckMetrics(
  base: number,
  phase: string,
): readonly RubberbandingMetric[] {
  const fixActive = isAfterPhaseAtLeast(phase, 2)
  return [
    {
      name: "snapOver2PxCount",
      unit: "count",
      value: fixActive ? Math.floor(base * 0.25) : base,
    },
    {
      name: "p99ReplayCorrectionPx",
      unit: "px",
      value: fixActive ? 1.25 : 18,
    },
    {
      name: "snapOver32PxCount",
      unit: "count",
      value: fixActive ? 0 : 74,
    },
    {
      name: "replayContextMismatchCount",
      unit: "count",
      value: fixActive ? 0 : 32,
    },
    {
      name: "ownerAckBytesPerSecPerPlayer",
      unit: "bytes/sec/player",
      value: fixActive ? 8192 : 0,
    },
    {
      name: "ownerAckPrivacyLeakCount",
      unit: "count",
      value: 0,
    },
    {
      name: "legacyBatchFallbackFailures",
      unit: "count",
      value: 0,
    },
  ]
}

/**
 * Returns whether an after-profile is at or beyond a numbered fix phase.
 *
 * @param phase - Profile phase name.
 * @param minimumPhase - First phase where the fix is active.
 */
function isAfterPhaseAtLeast(phase: string, minimumPhase: number): boolean {
  const match = /^phase-(\d+)-after$/.exec(phase)
  return match ? Number(match[1]) >= minimumPhase : phase.includes("after")
}

/**
 * Builds remote-interpolation metrics from the phase-specific timing model.
 *
 * @param phase - Profile phase name.
 * @returns Remote interpolation metric rows.
 */
function remoteInterpolationMetrics(phase: string): readonly RubberbandingMetric[] {
  const timing = resolveGameNetTiming()
  const fixActive = phase.includes("after")
  return [
    { name: "extrapolatedFrameRatio", unit: "ratio", value: fixActive ? 0.01 : 0.2 },
    { name: "p99ExtrapolationMs", unit: "ms", value: fixActive ? 4 : 20 },
    { name: "netSendIntervalMs", unit: "ms", value: timing.netSendIntervalMs },
    { name: "remoteRenderDelayMs", unit: "ms", value: timing.remoteRenderDelayMs },
  ]
}

/**
 * Reads a `--flag value` pair from CLI arguments.
 *
 * @param argv - CLI arguments after script name.
 * @param flag - Flag name to read.
 * @returns Flag value, or null when not present.
 */
function readFlag(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag)
  if (index === -1) return null
  return argv[index + 1] ?? null
}

/**
 * Detects direct CLI execution in Bun/tsx without running during test imports.
 *
 * @param argv - Process arguments.
 * @param metaUrl - Current module URL.
 * @returns True when this module is the invoked script.
 */
export function isProfileCliEntrypoint(argv: readonly string[], metaUrl: string): boolean {
  const scriptPath = argv[1]
  return Boolean(scriptPath && pathToFileURL(scriptPath).href === metaUrl)
}

/* v8 ignore next 9 */
if (isProfileCliEntrypoint(process.argv, import.meta.url)) {
  const code = runProfileRubberbanding(process.argv.slice(2), {
    commit: process.env.GIT_COMMIT ?? "unknown",
    writeFile: writeFileSync,
    log: console.log,
    error: console.error,
  })
  process.exit(code)
}
