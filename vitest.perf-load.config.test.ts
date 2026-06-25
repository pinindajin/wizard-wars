import { describe, expect, it } from "vitest"

import { resolvePerfLoadTestTimeoutMs } from "./vitest.perf-load.config"

describe("perf-load Vitest timeout config", () => {
  it("derives timeout from the configured soak duration plus startup/teardown margin", () => {
    expect(
      resolvePerfLoadTestTimeoutMs({
        WW_PERF_LOAD_SECONDS: "600",
      }),
    ).toBeGreaterThanOrEqual(780_000)
    expect(
      resolvePerfLoadTestTimeoutMs({
        WW_PERF_LOAD_SECONDS: "18000",
      }),
    ).toBeGreaterThanOrEqual(18_180_000)
  })

  it("supports explicit timeout override for unusually slow hosts", () => {
    expect(
      resolvePerfLoadTestTimeoutMs({
        WW_PERF_LOAD_TEST_TIMEOUT_MS: "42",
      }),
    ).toBe(42)
  })
})
