import { describe, expect, it } from "vitest"

import { parseClientLogLevel, parseServerLogLevel } from "./levels"

describe("log levels", () => {
  it("parses server levels case-insensitively", () => {
    expect(parseServerLogLevel(" WARN ")).toBe("warn")
    expect(parseServerLogLevel("silent")).toBe("silent")
    expect(parseServerLogLevel("nope")).toBeNull()
    expect(parseServerLogLevel(null)).toBeNull()
  })

  it("parses client levels without fatal", () => {
    expect(parseClientLogLevel("debug")).toBe("debug")
    expect(parseClientLogLevel("fatal")).toBeNull()
  })
})
