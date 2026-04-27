import { describe, expect, it, vi } from "vitest"

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
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
})
