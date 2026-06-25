import { describe, expect, it } from "vitest"

import { resolveServerMode, shouldRunMigrations } from "./runtimeConfig"

describe("runtime process config", () => {
  it("defaults to the single-process server mode", () => {
    expect(resolveServerMode({})).toBe("single")
  })

  it("accepts explicit web and realtime server modes", () => {
    expect(resolveServerMode({ WW_SERVER_MODE: " web " })).toBe("web")
    expect(resolveServerMode({ WW_SERVER_MODE: "realtime" })).toBe("realtime")
  })

  it("falls back to single-process mode for unknown values", () => {
    expect(resolveServerMode({ WW_SERVER_MODE: "worker" })).toBe("single")
  })

  it("runs migrations only with an explicit true flag", () => {
    expect(shouldRunMigrations({})).toBe(false)
    expect(shouldRunMigrations({ RUN_MIGRATIONS: "false" })).toBe(false)
    expect(shouldRunMigrations({ RUN_MIGRATIONS: "true" })).toBe(true)
  })
})
