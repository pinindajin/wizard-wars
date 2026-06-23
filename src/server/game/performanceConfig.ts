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

export type GamePerformanceConfig = {
  readonly simTickRateHz: number
  readonly simAccumulatorEnabled: boolean
  readonly simMaxCatchUpTicks: number
  readonly netSendRateHz: number
  readonly netSendIntervalMs: number
  readonly netTiming: GameNetTimingPayload
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
  }
}
