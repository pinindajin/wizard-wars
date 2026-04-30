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

  it("defaults backend logs to warn when LOG_LEVEL is unset", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LOG_LEVEL", "")
    const { resolveEnvLogLevel } = await import("./logger")
    expect(resolveEnvLogLevel()).toBe("warn")
  })

  it("applies a valid DB override", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LOG_LEVEL", "info")
    const { applyDbLogLevelOverride, logger } = await import("./logger")
    const result = await applyDbLogLevelOverride({
      appConfig: {
        findUnique: vi.fn().mockResolvedValue({ logLevel: "debug" }),
      },
    } as never)
    expect(result).toMatchObject({ status: "applied", effectiveLevel: "debug" })
    expect(logger.level).toBe("debug")
  })

  it("falls back when DB override is invalid", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LOG_LEVEL", "error")
    const { applyDbLogLevelOverride, logger } = await import("./logger")
    const result = await applyDbLogLevelOverride({
      appConfig: {
        findUnique: vi.fn().mockResolvedValue({ logLevel: "wat" }),
      },
    } as never)
    expect(result).toMatchObject({ status: "invalid", effectiveLevel: "error" })
    expect(logger.level).toBe("error")
  })

  it("treats missing DB row and null override as no override", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LOG_LEVEL", "trace")
    const { applyDbLogLevelOverride } = await import("./logger")
    await expect(
      applyDbLogLevelOverride({
        appConfig: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as never),
    ).resolves.toMatchObject({ status: "missing", effectiveLevel: "trace" })
    await expect(
      applyDbLogLevelOverride({
        appConfig: {
          findUnique: vi.fn().mockResolvedValue({ logLevel: null }),
        },
      } as never),
    ).resolves.toMatchObject({ status: "none", effectiveLevel: "trace" })
  })

  it("falls back when DB lookup fails", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LOG_LEVEL", "warn")
    const { applyDbLogLevelOverride } = await import("./logger")
    await expect(
      applyDbLogLevelOverride({
        appConfig: {
          findUnique: vi.fn().mockRejectedValue(new Error("db down")),
        },
      } as never),
    ).resolves.toMatchObject({ status: "failed", effectiveLevel: "warn" })
  })
})
