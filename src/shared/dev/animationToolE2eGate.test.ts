import { afterEach, describe, expect, it, vi } from "vitest"

import {
  allowAnimationToolInProductionE2e,
  isAnimationToolApiForbiddenInProduction,
  isAnimationToolPageUnavailableInProduction,
} from "./animationToolE2eGate"

describe("animationToolE2eGate", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("allow is false when neither E2E flag is set", () => {
    vi.stubEnv("WIZARD_WARS_E2E", "")
    vi.stubEnv("WW_ALLOW_ANIMATION_TOOL_IN_PRODUCTION_E2E", "")
    expect(allowAnimationToolInProductionE2e()).toBe(false)
  })

  it("production without bypass: API forbidden and page unavailable", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("WIZARD_WARS_E2E", "")
    vi.stubEnv("WW_ALLOW_ANIMATION_TOOL_IN_PRODUCTION_E2E", "")
    expect(isAnimationToolApiForbiddenInProduction()).toBe(true)
    expect(isAnimationToolPageUnavailableInProduction()).toBe(true)
  })

  it("production with WIZARD_WARS_E2E: allows page and APIs", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("WIZARD_WARS_E2E", "1")
    vi.stubEnv("WW_ALLOW_ANIMATION_TOOL_IN_PRODUCTION_E2E", "")
    expect(isAnimationToolApiForbiddenInProduction()).toBe(false)
    expect(isAnimationToolPageUnavailableInProduction()).toBe(false)
  })

  it("development: APIs are not production-forbidden", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("WIZARD_WARS_E2E", "")
    vi.stubEnv("WW_ALLOW_ANIMATION_TOOL_IN_PRODUCTION_E2E", "")
    expect(isAnimationToolApiForbiddenInProduction()).toBe(false)
    expect(isAnimationToolPageUnavailableInProduction()).toBe(false)
  })
})
