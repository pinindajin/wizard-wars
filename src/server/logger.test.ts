import { afterEach, describe, expect, it, vi } from "vitest"

describe("logger", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("loads with pino-pretty transport in non-production", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const { logger } = await import("./logger")
    expect(logger).toBeDefined()
  })

  it("loads without pretty transport in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const { logger } = await import("./logger")
    expect(logger).toBeDefined()
  })
})
