import { describe, it, expect, beforeEach } from "vitest"
import { RateLimiter } from "@/server/auth/rateLimit"

describe("RateLimiter", () => {
  let limiter: RateLimiter

  beforeEach(() => {
    limiter = new RateLimiter(3, 1000) // 3 per second for test speed
  })

  it("allows requests within the limit", () => {
    expect(limiter.check("ip1")).toBe(true)
    expect(limiter.check("ip1")).toBe(true)
    expect(limiter.check("ip1")).toBe(true)
  })

  it("blocks after limit is exceeded", () => {
    limiter.check("ip1")
    limiter.check("ip1")
    limiter.check("ip1")
    expect(limiter.check("ip1")).toBe(false)
  })

  it("tracks different keys independently", () => {
    limiter.check("ip1")
    limiter.check("ip1")
    limiter.check("ip1")
    expect(limiter.check("ip1")).toBe(false)
    expect(limiter.check("ip2")).toBe(true) // different key, not throttled
  })

  it("resets bucket for a key", () => {
    limiter.check("ip1")
    limiter.check("ip1")
    limiter.check("ip1")
    expect(limiter.check("ip1")).toBe(false)
    limiter.reset("ip1")
    expect(limiter.check("ip1")).toBe(true)
  })

  it("returns retryAfterMs > 0 when throttled", () => {
    limiter.check("ip1")
    limiter.check("ip1")
    limiter.check("ip1")
    limiter.check("ip1") // over limit
    const remaining = limiter.retryAfterMs("ip1")
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(1000)
  })

  it("returns 0 retryAfterMs for unknown key", () => {
    expect(limiter.retryAfterMs("unknown")).toBe(0)
  })
})
