import { describe, expect, it, vi } from "vitest"

import { ANIMATION_CONFIG } from "../src/shared/balance-config/animationConfig"
import {
  checkAnimationConfig,
  createCheckAnimationConfigDeps,
  runCheckAnimationConfig,
} from "./check-animation-config"

function makeDeps(readFile = () => JSON.stringify(ANIMATION_CONFIG)) {
  return {
    cwd: "/repo",
    readFile: vi.fn(readFile),
    log: vi.fn(),
    error: vi.fn(),
  }
}

describe("check animation config script", () => {
  it("builds default cli dependencies for a cwd", () => {
    const deps = createCheckAnimationConfigDeps("/repo")

    expect(deps.cwd).toBe("/repo")
    expect(deps.readFile).toBeTypeOf("function")
    expect(deps.log).toBeTypeOf("function")
    expect(deps.error).toBeTypeOf("function")
  })

  it("validates the committed animation config path", () => {
    const deps = makeDeps()

    expect(checkAnimationConfig(deps)).toEqual({
      configPath: "/repo/src/shared/balance-config/animation-config.json",
    })
    expect(deps.readFile).toHaveBeenCalledWith(
      "/repo/src/shared/balance-config/animation-config.json",
      "utf8",
    )
  })

  it("logs success and returns zero from the cli runner", () => {
    const deps = makeDeps()

    expect(runCheckAnimationConfig(deps)).toBe(0)
    expect(deps.log).toHaveBeenCalledWith(
      "animation config valid: /repo/src/shared/balance-config/animation-config.json",
    )
  })

  it("reports parse failures from the cli runner", () => {
    const deps = makeDeps(() => "{")

    expect(runCheckAnimationConfig(deps)).toBe(1)
    expect(deps.error).toHaveBeenCalledWith("animation config invalid")
    expect(deps.error).toHaveBeenCalledWith(expect.stringContaining("JSON"))
  })

  it("reports non-Error failures without assuming an error message", () => {
    const deps = makeDeps(() => {
      throw "boom"
    })

    expect(runCheckAnimationConfig(deps)).toBe(1)
    expect(deps.error).toHaveBeenCalledTimes(1)
    expect(deps.error).toHaveBeenCalledWith("animation config invalid")
  })
})
