import {
  DEFAULT_VISUAL_NET_SEND_RATE_HZ,
  TICK_RATE_HZ,
  resolveGameNetTiming,
} from "@/shared/balance-config/rendering"
import type { GameNetTimingPayload } from "@/shared/types"

export const DEFAULT_NET_SEND_RATE_HZ = DEFAULT_VISUAL_NET_SEND_RATE_HZ
export const MIN_NET_SEND_RATE_HZ = 10
export const MAX_NET_SEND_RATE_HZ = 60
export const DEFAULT_SIM_MAX_CATCH_UP_TICKS = 4
export const MIN_SIM_MAX_CATCH_UP_TICKS = 1
export const MAX_SIM_MAX_CATCH_UP_TICKS = 15
export const PERFORMANCE_STATUS_WINDOW_MS = 1_000
export const DEFAULT_SERVER_PERF_LOG_INTERVAL_MS = 1_000
export const MIN_SERVER_PERF_LOG_INTERVAL_MS = 250
export const MAX_SERVER_PERF_LOG_INTERVAL_MS = 60_000
export const DEFAULT_EVENT_LOOP_MONITOR_RESOLUTION_MS = 20
export const MIN_EVENT_LOOP_MONITOR_RESOLUTION_MS = 1
export const MAX_EVENT_LOOP_MONITOR_RESOLUTION_MS = 1_000
export const DEFAULT_PROD_CAPTURE_SECONDS = 60
export const MIN_PROD_CAPTURE_SECONDS = 5
export const MAX_PROD_CAPTURE_SECONDS = 18_000
export const DEFAULT_PROD_SAMPLE_INTERVAL_MS = 5_000
export const MIN_PROD_SAMPLE_INTERVAL_MS = 1_000
export const MAX_PROD_SAMPLE_INTERVAL_MS = 60_000

export type GamePerformanceConfig = {
  readonly simTickRateHz: number
  readonly simAccumulatorEnabled: boolean
  readonly simMaxCatchUpTicks: number
  readonly netSendRateHz: number
  readonly netSendIntervalMs: number
  readonly netTiming: GameNetTimingPayload
  readonly serverPerfLogsEnabled: boolean
  readonly serverPerfLogIntervalMs: number
  readonly eventLoopMonitorResolutionMs: number
  readonly gcMetricsEnabled: boolean
  readonly perfRunId: string | null
  readonly prodCaptureSeconds: number
  readonly prodSampleIntervalMs: number
}

/**
 * Parses one bounded integer env var.
 *
 * @param raw - Raw env string.
 * @param fallback - Value to use when raw is unset or invalid.
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @returns Parsed and clamped integer.
 */
function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/**
 * Parses a boolean env switch while preserving a safe fallback for unknown text.
 *
 * @param raw - Raw env string.
 * @param fallback - Value to use when raw is unset or unrecognized.
 * @returns Parsed boolean.
 */
function parseBooleanSwitch(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback
  const normalized = raw.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return fallback
}

/**
 * Sanitizes a run id for filenames and structured metric context.
 *
 * @param raw - Raw env value.
 * @returns A compact safe run id, or null when unset.
 */
export function sanitizePerfRunId(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null
  const sanitized = raw
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 80)
  return sanitized === "" ? null : sanitized
}

/**
 * Resolves game performance knobs from environment-like input.
 *
 * @param env - Environment source, defaults to process.env.
 * @returns Runtime performance config.
 */
export function resolveGamePerformanceConfig(
  env: {
    readonly WW_NET_SEND_RATE_HZ?: string | undefined
    readonly WW_SIM_ACCUMULATOR_ENABLED?: string | undefined
    readonly WW_SIM_MAX_CATCH_UP_TICKS?: string | undefined
    readonly WW_SERVER_PERF_LOGS?: string | undefined
    readonly WW_SERVER_PERF_LOG_INTERVAL_MS?: string | undefined
    readonly WW_EVENT_LOOP_MONITOR_RESOLUTION_MS?: string | undefined
    readonly WW_GC_METRICS?: string | undefined
    readonly WW_PERF_RUN_ID?: string | undefined
    readonly WW_PROD_CAPTURE_SECONDS?: string | undefined
    readonly WW_PROD_SAMPLE_INTERVAL_MS?: string | undefined
    readonly [key: string]: string | undefined
  } = process.env,
): GamePerformanceConfig {
  const netSendRateHz = parseBoundedInt(
    env.WW_NET_SEND_RATE_HZ,
    DEFAULT_NET_SEND_RATE_HZ,
    MIN_NET_SEND_RATE_HZ,
    MAX_NET_SEND_RATE_HZ,
  )
  const simMaxCatchUpTicks = parseBoundedInt(
    env.WW_SIM_MAX_CATCH_UP_TICKS,
    DEFAULT_SIM_MAX_CATCH_UP_TICKS,
    MIN_SIM_MAX_CATCH_UP_TICKS,
    MAX_SIM_MAX_CATCH_UP_TICKS,
  )
  const serverPerfLogIntervalMs = parseBoundedInt(
    env.WW_SERVER_PERF_LOG_INTERVAL_MS,
    DEFAULT_SERVER_PERF_LOG_INTERVAL_MS,
    MIN_SERVER_PERF_LOG_INTERVAL_MS,
    MAX_SERVER_PERF_LOG_INTERVAL_MS,
  )
  const eventLoopMonitorResolutionMs = parseBoundedInt(
    env.WW_EVENT_LOOP_MONITOR_RESOLUTION_MS,
    DEFAULT_EVENT_LOOP_MONITOR_RESOLUTION_MS,
    MIN_EVENT_LOOP_MONITOR_RESOLUTION_MS,
    MAX_EVENT_LOOP_MONITOR_RESOLUTION_MS,
  )
  return {
    simTickRateHz: TICK_RATE_HZ,
    simAccumulatorEnabled: parseBooleanSwitch(env.WW_SIM_ACCUMULATOR_ENABLED, true),
    simMaxCatchUpTicks,
    netSendRateHz,
    netSendIntervalMs: 1_000 / netSendRateHz,
    netTiming: resolveGameNetTiming({
      netSendRateHz,
      netSendIntervalMs: 1_000 / netSendRateHz,
    }),
    serverPerfLogsEnabled: parseBooleanSwitch(env.WW_SERVER_PERF_LOGS, false),
    serverPerfLogIntervalMs,
    eventLoopMonitorResolutionMs,
    gcMetricsEnabled: parseBooleanSwitch(env.WW_GC_METRICS, false),
    perfRunId: sanitizePerfRunId(env.WW_PERF_RUN_ID),
    prodCaptureSeconds: parseBoundedInt(
      env.WW_PROD_CAPTURE_SECONDS,
      DEFAULT_PROD_CAPTURE_SECONDS,
      MIN_PROD_CAPTURE_SECONDS,
      MAX_PROD_CAPTURE_SECONDS,
    ),
    prodSampleIntervalMs: parseBoundedInt(
      env.WW_PROD_SAMPLE_INTERVAL_MS,
      DEFAULT_PROD_SAMPLE_INTERVAL_MS,
      MIN_PROD_SAMPLE_INTERVAL_MS,
      MAX_PROD_SAMPLE_INTERVAL_MS,
    ),
  }
}
