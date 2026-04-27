import { describe, expect, it } from "vitest"

import { registerNodeInstrumentation } from "./instrumentation.node"

describe("registerNodeInstrumentation", () => {
  it("runs without throwing (loads dotenv for cwd .env)", () => {
    expect(() => registerNodeInstrumentation()).not.toThrow()
  })
})
