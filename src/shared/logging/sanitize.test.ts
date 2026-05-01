import { describe, expect, it } from "vitest"

import { sanitizeForLog, summarizePayload } from "./sanitize"

describe("sanitizeForLog", () => {
  it("redacts secrets and truncates long strings", () => {
    const result = sanitizeForLog({
      token: "abc",
      nested: { passwordHash: "hash", safe: "x".repeat(300) },
    }) as Record<string, unknown>
    expect(result.token).toBe("[REDACTED]")
    expect(result.nested).toMatchObject({ passwordHash: "[REDACTED]" })
    expect(JSON.stringify(result)).toContain("[truncated:300]")
  })

  it("handles errors, arrays, depth, and circular references", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const result = sanitizeForLog({
      err: new Error("boom"),
      arr: Array.from({ length: 12 }, (_, i) => i),
      circular,
    }) as Record<string, unknown>
    expect(result.err).toMatchObject({ name: "Error", message: "boom" })
    expect(result.arr).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(JSON.stringify(result)).toContain("[Circular]")
  })

  it("summarizes payload via sanitizer", () => {
    expect(summarizePayload({ cookie: "secret" })).toEqual({ cookie: "[REDACTED]" })
  })
})
