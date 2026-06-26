import { describe, expect, it } from "vitest"

import {
  DEFAULT_NET_SEND_RATE_HZ,
  MAX_NET_SEND_RATE_HZ,
  MIN_NET_SEND_RATE_HZ,
  resolveGamePerformanceConfig,
} from "./performanceConfig"

describe("game performance config", () => {
  it("defaults movement/projectile network flushes to 30 Hz while preserving 60 Hz simulation", () => {
    expect(resolveGamePerformanceConfig({})).toMatchObject({
      netSendRateHz: DEFAULT_NET_SEND_RATE_HZ,
      simTickRateHz: 60,
      simAccumulatorEnabled: true,
      simMaxCatchUpTicks: 10,
      netTiming: {
        protocolVersion: 1,
        netSendRateHz: DEFAULT_NET_SEND_RATE_HZ,
        netSendIntervalMs: 1000 / DEFAULT_NET_SEND_RATE_HZ,
        remoteRenderDelayMs: 84,
      },
    })
  })

  it("parses and clamps WW_NET_SEND_RATE_HZ", () => {
    expect(
      resolveGamePerformanceConfig({ WW_NET_SEND_RATE_HZ: "45" }).netSendRateHz,
    ).toBe(45)
    expect(
      resolveGamePerformanceConfig({ WW_NET_SEND_RATE_HZ: "1" }).netSendRateHz,
    ).toBe(MIN_NET_SEND_RATE_HZ)
    expect(
      resolveGamePerformanceConfig({ WW_NET_SEND_RATE_HZ: "1000" }).netSendRateHz,
    ).toBe(MAX_NET_SEND_RATE_HZ)
    expect(
      resolveGamePerformanceConfig({ WW_NET_SEND_RATE_HZ: "nope" }).netSendRateHz,
    ).toBe(DEFAULT_NET_SEND_RATE_HZ)
  })

  it("derives remote interpolation timing from the configured visual send rate", () => {
    expect(resolveGamePerformanceConfig({ WW_NET_SEND_RATE_HZ: "60" }).netTiming).toMatchObject({
      netSendRateHz: 60,
      netSendIntervalMs: 1000 / 60,
      remoteRenderDelayMs: 50,
    })
    expect(resolveGamePerformanceConfig({ WW_NET_SEND_RATE_HZ: "10" }).netTiming).toMatchObject({
      netSendRateHz: 10,
      netSendIntervalMs: 100,
      remoteRenderDelayMs: 217,
    })
  })

  it("parses server simulation accumulator rollback knobs", () => {
    expect(
      resolveGamePerformanceConfig({
        WW_SIM_ACCUMULATOR_ENABLED: "0",
        WW_SIM_MAX_CATCH_UP_TICKS: "3",
      }),
    ).toMatchObject({
      simAccumulatorEnabled: false,
      simMaxCatchUpTicks: 3,
    })
    expect(
      resolveGamePerformanceConfig({
        WW_SIM_ACCUMULATOR_ENABLED: "false",
        WW_SIM_MAX_CATCH_UP_TICKS: "1000",
      }),
    ).toMatchObject({
      simAccumulatorEnabled: false,
      simMaxCatchUpTicks: 15,
    })
    expect(
      resolveGamePerformanceConfig({
        WW_SIM_ACCUMULATOR_ENABLED: "yes",
        WW_SIM_MAX_CATCH_UP_TICKS: "0",
      }),
    ).toMatchObject({
      simAccumulatorEnabled: true,
      simMaxCatchUpTicks: 1,
    })
    expect(
      resolveGamePerformanceConfig({
        WW_SIM_ACCUMULATOR_ENABLED: "unexpected",
        WW_SIM_MAX_CATCH_UP_TICKS: "nope",
      }),
    ).toMatchObject({
      simAccumulatorEnabled: true,
      simMaxCatchUpTicks: 10,
    })
  })

  it("parses production performance instrumentation knobs", () => {
    expect(resolveGamePerformanceConfig({})).toMatchObject({
      serverPerfLogsEnabled: false,
      serverPerfLogIntervalMs: 1_000,
      eventLoopMonitorResolutionMs: 20,
      gcMetricsEnabled: false,
      perfRunId: null,
      prodCaptureSeconds: 60,
      prodSampleIntervalMs: 5_000,
    })

    expect(
      resolveGamePerformanceConfig({
        WW_SERVER_PERF_LOGS: "yes",
        WW_SERVER_PERF_LOG_INTERVAL_MS: "10",
        WW_EVENT_LOOP_MONITOR_RESOLUTION_MS: "5000",
        WW_GC_METRICS: "on",
        WW_PERF_RUN_ID: " local:compact/8 ",
        WW_PROD_CAPTURE_SECONDS: "1",
        WW_PROD_SAMPLE_INTERVAL_MS: "999999",
      }),
    ).toMatchObject({
      serverPerfLogsEnabled: true,
      serverPerfLogIntervalMs: 250,
      eventLoopMonitorResolutionMs: 1_000,
      gcMetricsEnabled: true,
      perfRunId: "local_compact_8",
      prodCaptureSeconds: 5,
      prodSampleIntervalMs: 60_000,
    })

    expect(resolveGamePerformanceConfig({ WW_PERF_RUN_ID: "!!!" }).perfRunId).toBeNull()
  })

  it("defaults send budget off with unlimited visual caps and bounded deferral", () => {
    expect(resolveGamePerformanceConfig({})).toMatchObject({
      netSendBudget: {
        enabled: false,
        maxPlayerDeltas: 0,
        maxProjectileDeltas: 0,
        maxRemovals: 0,
        maxBytes: 0,
        maxDeferralMs: 250,
      },
    })
  })

  it("parses send budget env knobs with zero as unlimited and deferral clamped", () => {
    expect(
      resolveGamePerformanceConfig({
        WW_NET_SEND_BUDGET_ENABLED: "on",
        WW_NET_SEND_BUDGET_MAX_PLAYER_DELTAS: "3",
        WW_NET_SEND_BUDGET_MAX_PROJECTILE_DELTAS: "4",
        WW_NET_SEND_BUDGET_MAX_REMOVALS: "5",
        WW_NET_SEND_BUDGET_MAX_BYTES: "1024",
        WW_NET_SEND_BUDGET_MAX_DEFERRAL_MS: "1",
      }).netSendBudget,
    ).toEqual({
      enabled: true,
      maxPlayerDeltas: 3,
      maxProjectileDeltas: 4,
      maxRemovals: 5,
      maxBytes: 1024,
      maxDeferralMs: 16,
    })

    expect(
      resolveGamePerformanceConfig({
        WW_NET_SEND_BUDGET_ENABLED: "unexpected",
        WW_NET_SEND_BUDGET_MAX_PLAYER_DELTAS: "-1",
        WW_NET_SEND_BUDGET_MAX_PROJECTILE_DELTAS: "0",
        WW_NET_SEND_BUDGET_MAX_REMOVALS: "nope",
        WW_NET_SEND_BUDGET_MAX_BYTES: "0",
        WW_NET_SEND_BUDGET_MAX_DEFERRAL_MS: "9999",
      }).netSendBudget,
    ).toEqual({
      enabled: false,
      maxPlayerDeltas: 0,
      maxProjectileDeltas: 0,
      maxRemovals: 0,
      maxBytes: 0,
      maxDeferralMs: 1_000,
    })
  })
})
