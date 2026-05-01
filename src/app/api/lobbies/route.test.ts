import { describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}))

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}))

vi.mock("@/server/db", () => ({
  prisma: prismaMock,
}))

import { cookies } from "next/headers"

import { GET } from "./route"

describe("GET /api/lobbies", () => {
  it("returns 401 without token", async () => {
    vi.mocked(cookies).mockResolvedValueOnce({
      get: () => undefined,
    } as never)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it("returns 401 when token invalid", async () => {
    vi.mocked(cookies).mockResolvedValueOnce({
      get: () => ({ value: "bad" }),
    } as never)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it("returns empty list when matchMaker missing", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    const { signToken } = await import("@/server/auth")
    const token = await signToken({ sub: "u1", username: "A" })
    vi.mocked(cookies).mockResolvedValueOnce({
      get: () => ({ value: token }),
    } as never)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    vi.unstubAllEnvs()
  })

  it("returns lobby list when matchMaker present", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    const { signToken } = await import("@/server/auth")
    const token = await signToken({ sub: "u1", username: "A" })
    vi.mocked(cookies).mockResolvedValueOnce({
      get: () => ({ value: token }),
    } as never)
    ;(globalThis as { __wizardWarsMatchMaker?: { query: () => Promise<unknown[]> } }).__wizardWarsMatchMaker = {
      query: vi.fn().mockResolvedValue([
        {
          roomId: "r1",
          locked: false,
          metadata: {
            lobbyPhase: "LOBBY",
            hostName: "Host",
            hostPlayerId: "h1",
            playerCount: 2,
            maxPlayers: 8,
          },
          clients: 2,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ]),
    }
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body[0].lobbyId).toBe("r1")
    delete (globalThis as { __wizardWarsMatchMaker?: unknown }).__wizardWarsMatchMaker
    vi.unstubAllEnvs()
  })

  it("clears cookie when protected user verification finds no DB user", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    vi.stubEnv("VERIFY_USER_ON_PROTECTED", "true")
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    const { signToken } = await import("@/server/auth")
    const token = await signToken({ sub: "u1", username: "A" })
    vi.mocked(cookies).mockResolvedValueOnce({
      get: () => ({ value: token }),
    } as never)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0")
    vi.unstubAllEnvs()
  })
})
