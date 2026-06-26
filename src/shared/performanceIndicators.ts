/** Stable player-facing order for performance warning icons. */
export const PERFORMANCE_ISSUE_ORDER = [
  "lost_connection",
  "server_cpu",
  "rubberbanding",
] as const

export type PerformanceIssueKind = (typeof PERFORMANCE_ISSUE_ORDER)[number]

export type RubberbandCorrection = "none" | "smooth" | "snap"

export type RubberbandCorrectionSample = {
  readonly atMs: number
  readonly correction: Exclude<RubberbandCorrection, "none">
}

export type RubberbandState = {
  readonly samples: readonly RubberbandCorrectionSample[]
  readonly activeUntilMs: number
}

export const RUBBERBAND_WINDOW_MS = 4_000
export const RUBBERBAND_CLEAR_MS = 3_000
export const RUBBERBAND_SMOOTH_THRESHOLD = 3
export const LOST_CONNECTION_STALE_MS = 5_000
export const SERVER_PERFORMANCE_STATUS_STALE_MS = 3_000
export const SERVER_PERFORMANCE_STATUS_MIN_INTERVAL_MS = 1_000
export const SERVER_CATCH_UP_DIAGNOSTIC_THRESHOLD = 2
export const SERVER_EVENT_LOOP_LAG_DIAGNOSTIC_THRESHOLD_MS = 16
export const SERVER_BROADCAST_DIAGNOSTIC_THRESHOLD_MS = 50

export type ServerPerformanceStatusReason =
  | "dropped_debt"
  | "catch_up"
  | "input_queue_drops"
  | "event_loop_lag"
  | "broadcast_slow"

export type ServerPerformanceMetrics = {
  readonly windowMs: number
  readonly droppedDebtMs: number
  readonly catchUpCallbacks: number
  readonly inputQueueDrops: number
  readonly simDurationMs: number
  readonly broadcastDurationMs: number
  readonly roomTickDurationMs?: number
  readonly visualFlushDurationMs?: number
  readonly ownerAckSendDurationMs?: number
  readonly immediateBroadcastDurationMs?: number
  readonly visualBudgetDeferrals?: number
  readonly visualBudgetDeferredEntities?: number
  readonly visualBudgetMaxDeferralAgeMs?: number
  readonly visualBudgetDroppedVisuals?: number
  readonly criticalSendFailures?: number
  readonly processEventLoopDelayMs?: number
  readonly processEventLoopDelayP95Ms?: number
  readonly eventLoopUtilization?: number
  readonly gcPauseMs?: number
  readonly eventLoopLagMs: number
  readonly processCpuPercent: number
  readonly heapUsedBytes: number
  readonly rssBytes: number
  readonly activeRooms: number
  readonly connectedClients: number
}

export type ServerPerformanceClassification = {
  readonly degraded: boolean
  readonly reasons: readonly ServerPerformanceStatusReason[]
}

/**
 * Creates an empty rubberbanding detector state.
 *
 * @returns Initial rubberbanding state.
 */
export function createRubberbandState(): RubberbandState {
  return { samples: [], activeUntilMs: 0 }
}

/**
 * Keeps only correction samples inside the rolling rubberband window.
 *
 * @param samples - Existing correction samples.
 * @param nowMs - Current wall-clock or test time in milliseconds.
 * @returns Samples whose timestamps are still inside the rolling window.
 */
export function pruneRubberbandSamples(
  samples: readonly RubberbandCorrectionSample[],
  nowMs: number,
): readonly RubberbandCorrectionSample[] {
  const oldestIncludedAtMs = nowMs - RUBBERBAND_WINDOW_MS
  return samples.filter((sample) => sample.atMs >= oldestIncludedAtMs)
}

/**
 * Records a local reconciliation correction and updates indicator activity.
 *
 * @param state - Previous rubberband detector state.
 * @param correction - Correction classification from reconciliation.
 * @param nowMs - Current wall-clock or test time in milliseconds.
 * @returns Updated rubberband detector state.
 */
export function recordRubberbandCorrection(
  state: RubberbandState,
  correction: RubberbandCorrection,
  nowMs: number,
): RubberbandState {
  const samples =
    correction === "none"
      ? pruneRubberbandSamples(state.samples, nowMs)
      : pruneRubberbandSamples([...state.samples, { atMs: nowMs, correction }], nowMs)

  const snapSeen = samples.some((sample) => sample.correction === "snap")
  const smoothCount = samples.filter((sample) => sample.correction === "smooth").length
  const alreadyActive = state.activeUntilMs > nowMs
  const shouldActivate =
    correction === "snap" ||
    snapSeen ||
    smoothCount >= RUBBERBAND_SMOOTH_THRESHOLD ||
    (alreadyActive && correction !== "none")

  return {
    samples,
    activeUntilMs: shouldActivate ? nowMs + RUBBERBAND_CLEAR_MS : state.activeUntilMs,
  }
}

/**
 * Returns whether the rubberbanding warning should currently be visible.
 *
 * @param state - Rubberband detector state.
 * @param nowMs - Current wall-clock or test time in milliseconds.
 * @returns True when the warning is active.
 */
export function isRubberbanding(state: RubberbandState, nowMs: number): boolean {
  return state.activeUntilMs > nowMs
}

/**
 * Detects a stale authoritative message stream.
 *
 * @param lastMessageAtMs - Last authoritative message time.
 * @param nowMs - Current wall-clock or test time in milliseconds.
 * @returns True when no authoritative message has arrived within the stale threshold.
 */
export function isAuthoritativeMessageStale(
  lastMessageAtMs: number,
  nowMs: number,
): boolean {
  return nowMs - lastMessageAtMs >= LOST_CONNECTION_STALE_MS
}

/**
 * Classifies low-rate server loop metrics into player-facing warning reasons.
 *
 * @param metrics - Aggregated server loop metrics for one reporting window.
 * @returns Degradation state and stable ordered reasons.
 */
export function classifyServerPerformance(
  metrics: ServerPerformanceMetrics,
): ServerPerformanceClassification {
  const reasons: ServerPerformanceStatusReason[] = []
  if (metrics.droppedDebtMs > 0) reasons.push("dropped_debt")
  if (
    (metrics.droppedDebtMs > 0 || metrics.inputQueueDrops > 0) &&
    metrics.catchUpCallbacks >= SERVER_CATCH_UP_DIAGNOSTIC_THRESHOLD
  ) {
    reasons.push("catch_up")
  }
  if (metrics.inputQueueDrops > 0) reasons.push("input_queue_drops")
  if (metrics.eventLoopLagMs >= SERVER_EVENT_LOOP_LAG_DIAGNOSTIC_THRESHOLD_MS) {
    reasons.push("event_loop_lag")
  }
  if (metrics.broadcastDurationMs >= SERVER_BROADCAST_DIAGNOSTIC_THRESHOLD_MS) {
    reasons.push("broadcast_slow")
  }
  return {
    degraded: reasons.length > 0,
    reasons,
  }
}

/**
 * Builds a stable key for rate-limiting server performance status broadcasts.
 *
 * @param status - Classified server status.
 * @returns Stable nominal/reason key.
 */
export function serverPerformanceStatusKey(
  status: ServerPerformanceClassification,
): string {
  return status.degraded ? status.reasons.join("|") : "nominal"
}
