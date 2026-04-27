import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AUTH_COOKIE_NAME,
  createAuthCookie,
  createClearAuthCookie,
  hashPassword,
  signToken,
  verifyPassword,
  verifyToken,
} from "./index"

describe("server auth helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("has expected cookie name", () => {
    expect(AUTH_COOKIE_NAME).toBe("ww-token")
  })

  it("hashes and verifies password", async () => {
    const hash = await hashPassword("secret1234")
    expect(await verifyPassword("secret1234", hash)).toBe(true)
    expect(await verifyPassword("wrong", hash)).toBe(false)
  })

  it("signs and verifies token", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    const token = await signToken({ sub: "user-1", username: "Pat" })
    const user = await verifyToken(token)
    expect(user.sub).toBe("user-1")
    expect(user.username).toBe("Pat")
  })

  it("createAuthCookie omits Secure outside production", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    vi.stubEnv("NODE_ENV", "development")
    const token = await signToken({ sub: "a", username: "b" })
    const c = createAuthCookie(token)
    expect(c).toContain("HttpOnly")
    expect(c).not.toContain("Secure")
  })

  it("createAuthCookie adds Secure in production", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    vi.stubEnv("NODE_ENV", "production")
    const token = await signToken({ sub: "a", username: "b" })
    const c = createAuthCookie(token)
    expect(c).toContain("Secure")
  })

  it("createClearAuthCookie clears token", () => {
    expect(createClearAuthCookie()).toContain("Max-Age=0")
  })
})
