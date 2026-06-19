import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

import type { RubberbandingMetric, RubberbandingProfileReport } from "./profile-rubberbanding"

export type RubberbandingAssertResult = {
  readonly ok: boolean
  readonly failures: readonly string[]
}

type AssertRubberbandingProfileOptions = {
  readonly baseline: RubberbandingProfileReport
  readonly after: RubberbandingProfileReport
}

type MetricThreshold = {
  readonly metric: string
  readonly absoluteMax?: number
  readonly relativeMaxRatio?: number
}

const THRESHOLDS_BY_SCENARIO: ReadonlyMap<string, readonly MetricThreshold[]> = new Map([
  [
    "remote-interpolation",
    [
      { metric: "extrapolatedFrameRatio", relativeMaxRatio: 0.1 },
      { metric: "p99ExtrapolationMs", absoluteMax: 8 },
    ],
  ],
  ["owner-ack", [{ metric: "snapOver2PxCount", relativeMaxRatio: 0.5 }]],
  [
    "server-loop-catch-up",
    [
      { metric: "simulatedDriftMsAfter100MsStall", absoluteMax: 1 },
      { metric: "droppedDebtMs", absoluteMax: 0 },
      { metric: "tickDeficitAfter100MsStall", absoluteMax: 0 },
    ],
  ],
  [
    "world-collision",
    [
      { metric: "worldCollisionP95Ms", relativeMaxRatio: 0.7 },
      { metric: "worldCollisionP99Ms", relativeMaxRatio: 0.7 },
    ],
  ],
  [
    "homing-orb-pressure",
    [
      { metric: "homingOrbBurstBytes", relativeMaxRatio: 0.6 },
      { metric: "homingOrbSnapOnBatchCount", absoluteMax: 0 },
    ],
  ],
  [
    "input-bandwidth",
    [
      { metric: "idleInputMessagesPerSecond", relativeMaxRatio: 0.1 },
      { metric: "idleInputBytesPerSecond", relativeMaxRatio: 0.1 },
      { metric: "transitionAckLatencyMs", absoluteMax: 100 },
    ],
  ],
  ["swift-boots", [{ metric: "swiftBootsPredictionSnapPx", absoluteMax: 0 }]],
])

const PHASE_SCENARIO_BY_NUMBER: ReadonlyMap<number, string> = new Map([
  [1, "remote-interpolation"],
  [2, "owner-ack"],
  [3, "server-loop-catch-up"],
  [4, "world-collision"],
  [5, "homing-orb-pressure"],
  [6, "input-bandwidth"],
  [7, "swift-boots"],
])

/**
 * Compares a rubberbanding after-profile against its baseline profile.
 *
 * @param options - Baseline and after profile reports.
 * @returns Pass/fail result with human-readable failure messages.
 */
export function assertRubberbandingProfile(
  options: AssertRubberbandingProfileOptions,
): RubberbandingAssertResult {
  const failures: string[] = []
  const baselineScenarios = new Map(
    options.baseline.scenarios.map((scenario) => [scenario.scenario, scenario]),
  )
  const afterScenarios = new Map(
    options.after.scenarios.map((scenario) => [scenario.scenario, scenario]),
  )

  for (const scenario of baselineScenarios.keys()) {
    if (!afterScenarios.has(scenario)) failures.push(`missing after scenario: ${scenario}`)
  }
  for (const scenario of afterScenarios.keys()) {
    if (!baselineScenarios.has(scenario)) failures.push(`missing baseline scenario: ${scenario}`)
  }

  for (const [scenarioName, thresholds] of thresholdsForPhase(options.after.phase)) {
    const baseline = baselineScenarios.get(scenarioName)
    const after = afterScenarios.get(scenarioName)
    if (!baseline || !after) continue
    failures.push(...assertScenarioThresholds(scenarioName, baseline.metrics, after.metrics, thresholds))
  }

  return {
    ok: failures.length === 0,
    failures,
  }
}

/**
 * Selects assertion thresholds for a numbered phase profile.
 *
 * @param phase - After-profile phase name.
 * @returns Scenario thresholds relevant to the phase, or all thresholds for unnumbered profiles.
 */
function thresholdsForPhase(phase: string): ReadonlyMap<string, readonly MetricThreshold[]> {
  const phaseNumber = profilePhaseNumber(phase)
  if (phaseNumber === null) return THRESHOLDS_BY_SCENARIO
  const scenario = PHASE_SCENARIO_BY_NUMBER.get(phaseNumber)
  if (scenario === undefined) return new Map()
  const thresholds = THRESHOLDS_BY_SCENARIO.get(scenario)!
  return new Map([[scenario, thresholds]])
}

/**
 * Extracts a numeric phase identifier from profile names such as `phase-1-after`.
 *
 * @param phase - Profile phase string.
 * @returns Phase number, or null when the profile is not phase-numbered.
 */
function profilePhaseNumber(phase: string): number | null {
  const match = /^phase-(\d+)-/.exec(phase)
  return match ? Number(match[1]) : null
}

/**
 * Runs the profile assertion CLI with injected dependencies for testability.
 *
 * @param argv - CLI arguments after script name.
 * @param deps - File-system and logging dependencies.
 * @returns Process-style exit code.
 */
export function runAssertRubberbandingProfile(
  argv: readonly string[],
  deps: {
    readonly readFile: (path: string, encoding: BufferEncoding) => string
    readonly log: (value: string) => void
    readonly error: (value: string) => void
  },
): number {
  try {
    const { baselinePath, afterPath } = parseAssertArgs(argv)
    const result = assertRubberbandingProfile({
      baseline: JSON.parse(deps.readFile(baselinePath, "utf8")) as RubberbandingProfileReport,
      after: JSON.parse(deps.readFile(afterPath, "utf8")) as RubberbandingProfileReport,
    })
    if (result.ok) {
      deps.log("rubberbanding profile assertions passed")
      return 0
    }
    for (const failure of result.failures) deps.error(failure)
    return 1
  } catch (error) {
    deps.error("rubberbanding profile assertion failed")
    if (error instanceof Error) deps.error(error.message)
    return 1
  }
}

/**
 * Parses the assertion CLI arguments.
 *
 * @param argv - CLI arguments after script name.
 * @returns Required baseline and after JSON paths.
 */
export function parseAssertArgs(argv: readonly string[]): {
  readonly baselinePath: string
  readonly afterPath: string
} {
  const baselinePath = readFlag(argv, "--baseline")
  const afterPath = readFlag(argv, "--after")
  if (!baselinePath || !afterPath) {
    throw new Error("usage: assert-rubberbanding-profile --baseline <path> --after <path>")
  }
  return { baselinePath, afterPath }
}

/**
 * Applies scenario-specific thresholds to matching baseline and after metrics.
 *
 * @param scenario - Scenario name for failure messages.
 * @param baselineMetrics - Baseline metrics.
 * @param afterMetrics - After-change metrics.
 * @param thresholds - Threshold rules for this scenario.
 * @returns Failure messages for unmet thresholds.
 */
function assertScenarioThresholds(
  scenario: string,
  baselineMetrics: readonly RubberbandingMetric[],
  afterMetrics: readonly RubberbandingMetric[],
  thresholds: readonly MetricThreshold[],
): readonly string[] {
  const failures: string[] = []
  const baseline = metricMap(baselineMetrics)
  const after = metricMap(afterMetrics)
  for (const threshold of thresholds) {
    const baselineValue = baseline.get(threshold.metric)
    const afterValue = after.get(threshold.metric)
    if (baselineValue === undefined) {
      failures.push(`${scenario} missing baseline metric: ${threshold.metric}`)
    }
    if (afterValue === undefined) {
      failures.push(`${scenario} missing after metric: ${threshold.metric}`)
    }
    if (baselineValue === undefined || afterValue === undefined) continue
    const expected = expectedMax(baselineValue, threshold)
    if (afterValue > expected) {
      failures.push(
        `${scenario} ${threshold.metric} expected <= ${expected.toFixed(4)}, got ${afterValue.toFixed(4)}`,
      )
    }
  }
  return failures
}

/**
 * Converts metrics into a name-to-value map.
 *
 * @param metrics - Metric rows.
 * @returns Map of metric values by name.
 */
function metricMap(metrics: readonly RubberbandingMetric[]): ReadonlyMap<string, number> {
  return new Map(metrics.map((metric) => [metric.name, metric.value]))
}

/**
 * Resolves the maximum allowed after-value for a threshold.
 *
 * @param baselineValue - Baseline metric value.
 * @param threshold - Threshold rule.
 * @returns Maximum allowed after-value.
 */
function expectedMax(baselineValue: number, threshold: MetricThreshold): number {
  const absolute = threshold.absoluteMax ?? Number.POSITIVE_INFINITY
  const relative =
    threshold.relativeMaxRatio === undefined
      ? Number.POSITIVE_INFINITY
      : baselineValue * threshold.relativeMaxRatio
  return Math.min(absolute, relative)
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
export function isAssertCliEntrypoint(argv: readonly string[], metaUrl: string): boolean {
  const scriptPath = argv[1]
  return Boolean(scriptPath && pathToFileURL(scriptPath).href === metaUrl)
}

/* v8 ignore next 10 */
if (isAssertCliEntrypoint(process.argv, import.meta.url)) {
  const code = runAssertRubberbandingProfile(process.argv.slice(2), {
    readFile: readFileSync,
    log: console.log,
    error: console.error,
  })
  process.exit(code)
}
