import {
  DEFAULT_VISUAL_NET_SEND_RATE_HZ,
  TICK_RATE_HZ,
  resolveGameNetTiming,
} from "@/shared/balance-config/rendering"
import type { GameNetTimingPayload } from "@/shared/types"

export const DEFAULT_NET_SEND_RATE_HZ = DEFAULT_VISUAL_NET_SEND_RATE_HZ
export const MIN_NET_SEND_RATE_HZ = 10
export const MAX_NET_SEND_RATE_HZ = 60
export const PERFORMANCE_STATUS_WINDOW_MS = 1_000

export type GamePerformanceConfig = {
  readonly simTickRateHz: number
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
 * Resolves game performance knobs from environment-like input.
 *
 * @param env - Environment source, defaults to process.env.
 * @returns Runtime performance config.
 */
export function resolveGamePerformanceConfig(
  env: {
    readonly WW_NET_SEND_RATE_HZ?: string | undefined
    readonly [key: string]: string | undefined
  } = process.env,
): GamePerformanceConfig {
  const netSendRateHz = parseBoundedInt(
    env.WW_NET_SEND_RATE_HZ,
    DEFAULT_NET_SEND_RATE_HZ,
    MIN_NET_SEND_RATE_HZ,
    MAX_NET_SEND_RATE_HZ,
  )
  return {
    simTickRateHz: TICK_RATE_HZ,
    netSendRateHz,
    netSendIntervalMs: 1_000 / netSendRateHz,
    netTiming: resolveGameNetTiming({
      netSendRateHz,
      netSendIntervalMs: 1_000 / netSendRateHz,
    }),
  }
}
