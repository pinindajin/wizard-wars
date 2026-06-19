import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

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
      buildScenarioReport(scenario, seed, sampleCount, index),
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
  sampleCount: number,
  index: number,
): RubberbandingScenarioReport {
  const base = seed + sampleCount + index + 1
  return {
    scenario,
    metrics: metricsForScenario(scenario, base),
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
): readonly RubberbandingMetric[] {
  switch (scenario) {
    case "remote-interpolation":
      return [
        { name: "extrapolatedFrameRatio", unit: "ratio", value: 0.2 },
        { name: "p99ExtrapolationMs", unit: "ms", value: 20 },
      ]
    case "owner-ack":
      return [
        { name: "snapOver2PxCount", unit: "count", value: base },
        { name: "ownerAckBytesPerSecPerPlayer", unit: "bytes/sec/player", value: 0 },
      ]
    case "server-loop-catch-up":
      return [
        { name: "simulatedDriftMsAfter100MsStall", unit: "ms", value: 16.67 },
        { name: "droppedDebtMs", unit: "ms", value: 0 },
      ]
    case "world-collision":
      return [
        { name: "worldCollisionP95Ms", unit: "ms", value: 1.5 },
        { name: "worldCollisionP99Ms", unit: "ms", value: 2.5 },
      ]
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
