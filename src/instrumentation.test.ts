import { afterEach, describe, expect, it, vi } from "vitest"

const { registerNodeInstrumentation } = vi.hoisted(() => ({
  registerNodeInstrumentation: vi.fn(),
}))

vi.mock("./instrumentation.node", () => ({
  registerNodeInstrumentation,
}))

describe("instrumentation register", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    registerNodeInstrumentation.mockClear()
  })

  it("returns early when NEXT_RUNTIME is not nodejs", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge")
    const { register } = await import("./instrumentation")
    await register()
    expect(registerNodeInstrumentation).not.toHaveBeenCalled()
  })

  it("delegates to node when NEXT_RUNTIME is nodejs", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    const { register } = await import("./instrumentation")
    await register()
    expect(registerNodeInstrumentation).toHaveBeenCalledOnce()
  })
})
