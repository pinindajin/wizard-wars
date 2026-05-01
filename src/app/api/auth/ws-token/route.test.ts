import { describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}))

vi.mock("@/server/db", () => ({
  prisma: prismaMock,
}))

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

  it("clears cookie when protected user verification finds no DB user", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    vi.stubEnv("VERIFY_USER_ON_PROTECTED", "true")
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    const { signToken } = await import("@/server/auth")
    const token = await signToken({ sub: "u1", username: "Sam" })
    const res = await GET(req(token))
    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0")
    vi.unstubAllEnvs()
  })
})
