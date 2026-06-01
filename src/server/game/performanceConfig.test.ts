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
})
