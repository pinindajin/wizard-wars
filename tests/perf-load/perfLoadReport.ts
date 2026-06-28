import { join } from "node:path"

import { sanitizePerfRunId } from "@/server/game/performanceConfig"
import type { ServerPerformanceStatusPayload } from "@/shared/types"

export type PerfLoadReportInput = {
  readonly runId: string | null
  readonly scenarioId: string
  readonly startedAtIso: string
  readonly endedAtIso: string
  readonly clientCount: number
  readonly seconds: number
  readonly inputRateHz: number
  readonly transport: string
  readonly sentInputs: number
  readonly ownerAcks: number
  readonly playerBatches: number
  readonly roomWideAckCursorLeaks: number
  readonly wrongOwnerAckCount: number
  readonly clientsWithoutOwnerAcks: number
  readonly minOwnerAcksPerClient: number
  readonly ackGapsMs: readonly number[]
  readonly playerBatchGapsMs: readonly number[]
  readonly statuses: readonly ServerPerformanceStatusPayload[]
  readonly activeRoomsAfterCleanup: number
  readonly diagnosticOnly?: boolean | undefined
  readonly diagnosticReason?: string | null | undefined
  readonly maxDegradedStatusCount?: number | undefined
}

export type PerfLoadReport = {
  readonly runId: string | null
  readonly scenarioId: string
  readonly startedAtIso: string
  readonly endedAtIso: string
  readonly clientCount: number
  readonly seconds: number
  readonly inputRateHz: number
  readonly transport: string
  readonly sentInputs: number
  readonly ownerAcks: number
  readonly playerBatches: number
  readonly roomWideAckCursorLeaks: number
  readonly wrongOwnerAckCount: number
  readonly clientsWithoutOwnerAcks: number
  readonly minOwnerAcksPerClient: number
  readonly maxAckGapMs: number
  readonly ackGapP95Ms: number
  readonly ackGapP99Ms: number
  readonly maxPlayerBatchGapMs: number
  readonly playerBatchGapP95Ms: number
  readonly playerBatchGapP99Ms: number
  readonly statusCount: number
  readonly degradedStatusCount: number
  readonly degradedStatusBudget: number
  readonly degradedReasons: readonly string[]
  readonly degradedReasonCounts: Readonly<Record<string, number>>
  readonly inputQueueDrops: number
  readonly compactInputV1Fallbacks: number
  readonly compactInputV2Batches: number
  readonly compactInputV2Runs: number
  readonly compactInputV2CommandSeqs: number
  readonly visualBudgetDeferrals: number
  readonly visualBudgetDeferredEntities: number
  readonly visualBudgetMaxDeferralAgeMs: number
  readonly visualBudgetDroppedVisuals: number
  readonly criticalSendFailures: number
  readonly heapUsedDeltaBytes: number | null
  readonly rssDeltaBytes: number | null
  readonly activeRoomsAfterCleanup: number
  /** Retained for report compatibility; delayed post-grace checks detect leaks. */
  readonly activeRoomLeakDetected: boolean
  readonly diagnosticOnly: boolean
  readonly diagnosticReason: string | null
  readonly lastStatus: ServerPerformanceStatusPayload | null
}

/**
 * Builds the stable JSON artifact path for one perf-load scenario.
 *
 * @param input - Current cwd, optional run id, scenario id, and timestamp fallback.
 * @returns Deterministic artifact path when a run id is present.
 */
export function resolvePerfLoadReportPath(input: {
  readonly cwd: string
  readonly runId: string | null
  readonly scenarioId: string
  readonly startedAtMs?: number | undefined
}): string {
  const runId = sanitizePerfRunId(input.runId ?? undefined)
  const filenameBase = runId ?? String(input.startedAtMs ?? Date.now())
  return join(
    input.cwd,
    "test-results",
    "perf-load",
    `${filenameBase}-${input.scenarioId}.json`,
  )
}

/**
 * Returns the nearest-rank percentile from one sample set.
 *
 * @param samples - Numeric samples to summarize.
 * @param percentileValue - Percentile in the inclusive `0..100` range.
 * @returns Percentile sample, or zero when there are no samples.
 */
export function percentile(
  samples: readonly number[],
  percentileValue: number,
): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((left, right) => left - right)
  const bounded = Math.min(100, Math.max(0, percentileValue))
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((bounded / 100) * sorted.length) - 1),
  )
  return roundMetric(sorted[index] ?? 0)
}

/**
 * Resolves the absolute degraded-status budget for a perf-load run.
 *
 * @param input - Scenario duration, strict budget, and diagnostic-only flag.
 * @returns The allowed degraded status count.
 */
export function degradedStatusBudget(input: {
  readonly seconds: number
  readonly maxDegradedStatusCount: number
  readonly diagnosticOnly: boolean
}): number {
  if (!input.diagnosticOnly) return input.maxDegradedStatusCount
  return Math.max(input.maxDegradedStatusCount, Math.ceil(input.seconds / 60))
}

/**
 * Summarizes raw perf-load counters into the persisted PR evidence artifact.
 *
 * @param input - Raw scenario counters and captured server status payloads.
 * @returns Stable JSON-ready perf-load report.
 */
export function summarizePerfLoadRun(input: PerfLoadReportInput): PerfLoadReport {
  const statuses = [...input.statuses].sort(
    (left, right) => left.serverTimeMs - right.serverTimeMs,
  )
  const degradedStatuses = statuses.filter((status) => status.degraded)
  const degradedReasonCounts: Record<string, number> = {}
  for (const status of degradedStatuses) {
    for (const reason of status.reasons) {
      degradedReasonCounts[reason] = (degradedReasonCounts[reason] ?? 0) + 1
    }
  }

  const firstStatus = statuses[0] ?? null
  const lastStatus = statuses.at(-1) ?? null
  const diagnosticOnly = input.diagnosticOnly === true
  const maxDegradedStatusCount = input.maxDegradedStatusCount ?? 1

  return {
    runId: sanitizePerfRunId(input.runId ?? undefined),
    scenarioId: input.scenarioId,
    startedAtIso: input.startedAtIso,
    endedAtIso: input.endedAtIso,
    clientCount: input.clientCount,
    seconds: input.seconds,
    inputRateHz: input.inputRateHz,
    transport: input.transport,
    sentInputs: input.sentInputs,
    ownerAcks: input.ownerAcks,
    playerBatches: input.playerBatches,
    roomWideAckCursorLeaks: input.roomWideAckCursorLeaks,
    wrongOwnerAckCount: input.wrongOwnerAckCount,
    clientsWithoutOwnerAcks: input.clientsWithoutOwnerAcks,
    minOwnerAcksPerClient: input.minOwnerAcksPerClient,
    maxAckGapMs: maxSample(input.ackGapsMs),
    ackGapP95Ms: percentile(input.ackGapsMs, 95),
    ackGapP99Ms: percentile(input.ackGapsMs, 99),
    maxPlayerBatchGapMs: maxSample(input.playerBatchGapsMs),
    playerBatchGapP95Ms: percentile(input.playerBatchGapsMs, 95),
    playerBatchGapP99Ms: percentile(input.playerBatchGapsMs, 99),
    statusCount: statuses.length,
    degradedStatusCount: degradedStatuses.length,
    degradedStatusBudget: degradedStatusBudget({
      seconds: input.seconds,
      maxDegradedStatusCount,
      diagnosticOnly,
    }),
    degradedReasons: Object.keys(degradedReasonCounts).sort(),
    degradedReasonCounts,
    inputQueueDrops: statuses.reduce(
      (sum, status) => sum + status.metrics.inputQueueDrops,
      0,
    ),
    compactInputV1Fallbacks: statuses.reduce(
      (sum, status) => sum + (status.metrics.compactInputV1Fallbacks ?? 0),
      0,
    ),
    compactInputV2Batches: statuses.reduce(
      (sum, status) => sum + (status.metrics.compactInputV2Batches ?? 0),
      0,
    ),
    compactInputV2Runs: statuses.reduce(
      (sum, status) => sum + (status.metrics.compactInputV2Runs ?? 0),
      0,
    ),
    compactInputV2CommandSeqs: statuses.reduce(
      (sum, status) => sum + (status.metrics.compactInputV2CommandSeqs ?? 0),
      0,
    ),
    visualBudgetDeferrals: statuses.reduce(
      (sum, status) => sum + (status.metrics.visualBudgetDeferrals ?? 0),
      0,
    ),
    visualBudgetDeferredEntities: statuses.reduce(
      (sum, status) => sum + (status.metrics.visualBudgetDeferredEntities ?? 0),
      0,
    ),
    visualBudgetMaxDeferralAgeMs: maxSample(
      statuses.map((status) => status.metrics.visualBudgetMaxDeferralAgeMs ?? 0),
    ),
    visualBudgetDroppedVisuals: statuses.reduce(
      (sum, status) => sum + (status.metrics.visualBudgetDroppedVisuals ?? 0),
      0,
    ),
    criticalSendFailures: statuses.reduce(
      (sum, status) => sum + (status.metrics.criticalSendFailures ?? 0),
      0,
    ),
    heapUsedDeltaBytes:
      firstStatus && lastStatus
        ? lastStatus.metrics.heapUsedBytes - firstStatus.metrics.heapUsedBytes
        : null,
    rssDeltaBytes:
      firstStatus && lastStatus
        ? lastStatus.metrics.rssBytes - firstStatus.metrics.rssBytes
        : null,
    activeRoomsAfterCleanup: input.activeRoomsAfterCleanup,
    activeRoomLeakDetected: false,
    diagnosticOnly,
    diagnosticReason: input.diagnosticReason?.trim() || null,
    lastStatus,
  }
}

/**
 * Returns the maximum rounded sample value, or zero when empty.
 *
 * @param samples - Numeric samples to inspect.
 * @returns Maximum sample.
 */
function maxSample(samples: readonly number[]): number {
  if (samples.length === 0) return 0
  let max = Number.NEGATIVE_INFINITY
  for (const sample of samples) {
    if (sample > max) max = sample
  }
  return roundMetric(max)
}

/**
 * Rounds floating-point timing values to stable millisecond precision.
 *
 * @param value - Raw numeric metric.
 * @returns Rounded metric.
 */
function roundMetric(value: number): number {
  return Number(value.toFixed(3))
}
