import { describe, expect, it, vi } from "vitest"

import { ANIMATION_CONFIG } from "../src/shared/balance-config/animationConfig"
import { createAnimationSyncDeps, runAnimationSync, syncAnimationConfig } from "./animation-sync"

function makeDeps(overrides: {
  readFile?: () => string
  writeFile?: (path: string, value: string) => void
} = {}) {
  return {
    cwd: "/repo",
    readFile: vi.fn(overrides.readFile ?? (() => JSON.stringify({
      schemaVersion: 1,
      savedAt: "2026-01-01T00:00:00.000Z",
      config: ANIMATION_CONFIG,
    }))),
    writeFile: vi.fn(overrides.writeFile ?? (() => undefined)),
    log: vi.fn(),
    error: vi.fn(),
  }
}

describe("animation sync script", () => {
  it("builds default cli dependencies for a cwd", () => {
    const deps = createAnimationSyncDeps("/repo")

    expect(deps.cwd).toBe("/repo")
    expect(deps.readFile).toBeTypeOf("function")
    expect(deps.writeFile).toBeTypeOf("function")
    expect(deps.log).toBeTypeOf("function")
    expect(deps.error).toBeTypeOf("function")
  })

  it("writes the latest tool save config into the committed animation config path", () => {
    const deps = makeDeps()

    const result = syncAnimationConfig(deps)

    expect(result.latestPath).toBe("/repo/tools/animation/output/latest.json")
    expect(result.configPath).toBe("/repo/src/shared/balance-config/animation-config.json")
    expect(deps.writeFile).toHaveBeenCalledWith(
      "/repo/src/shared/balance-config/animation-config.json",
      `${JSON.stringify(ANIMATION_CONFIG, null, 2)}\n`,
    )
  })

  it("logs success and returns zero from the cli runner", () => {
    const deps = makeDeps()

    expect(runAnimationSync(deps)).toBe(0)
    expect(deps.log).toHaveBeenCalledWith(
      "synced /repo/tools/animation/output/latest.json -> /repo/src/shared/balance-config/animation-config.json",
    )
  })

  it("reports validation failures from the cli runner", () => {
    const deps = makeDeps({
      readFile: () => JSON.stringify({ schemaVersion: 1, savedAt: "2026-01-01T00:00:00.000Z" }),
    })

    expect(runAnimationSync(deps)).toBe(1)
    expect(deps.error).toHaveBeenCalledWith("animation sync failed")
    expect(deps.error).toHaveBeenCalledWith(expect.stringContaining("config"))
  })

  it("reports non-Error failures without assuming an error message", () => {
    const deps = makeDeps({
      readFile: () => {
        throw "boom"
      },
    })

    expect(runAnimationSync(deps)).toBe(1)
    expect(deps.error).toHaveBeenCalledTimes(1)
    expect(deps.error).toHaveBeenCalledWith("animation sync failed")
  })
})
