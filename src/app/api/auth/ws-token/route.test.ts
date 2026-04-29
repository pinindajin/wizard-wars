import { describe, expect, it, vi } from "vitest"

import { GET } from "./route"

function req(cookie?: string) {
  return {
    cookies: {
      get: (name: string) => (name === "ww-token" && cookie ? { value: cookie } : undefined),
    },
  } as Parameters<typeof GET>[0]
}

describe("GET /api/auth/ws-token", () => {
  it("returns 401 without cookie", async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it("returns session payload with valid token", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    const { signToken } = await import("@/server/auth")
    const token = await signToken({ sub: "u1", username: "Sam" })
    const res = await GET(req(token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ token, sub: "u1", username: "Sam" })
    vi.unstubAllEnvs()
  })

  it("returns 401 for bad token", async () => {
    const res = await GET(req("not-a-jwt"))
    expect(res.status).toBe(401)
  })
})
