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
})
