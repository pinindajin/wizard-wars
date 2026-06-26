import { beforeEach, describe, expect, it, vi } from "vitest"

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
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    prismaMock.user.findUnique.mockReset()
    prismaMock.user.findUnique.mockResolvedValue(null)
  })

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
    expect(await res.json()).toEqual({ lobbies: [], viewer: { isAdmin: false } })
  })

  it("returns lobby list and viewer admin status when matchMaker present", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "A",
      usernameLower: "a",
      isAdmin: true,
    })
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
    expect(body.viewer.isAdmin).toBe(true)
    expect(Array.isArray(body.lobbies)).toBe(true)
    expect(body.lobbies[0].lobbyId).toBe("r1")
    delete (globalThis as { __wizardWarsMatchMaker?: unknown }).__wizardWarsMatchMaker
  })

  it("uses realtime admin bridge when configured", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    vi.stubEnv("WW_REALTIME_ADMIN_URL", "http://realtime:3001")
    vi.stubEnv("WW_REALTIME_ADMIN_TOKEN", "secret")
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          lobbies: [
            {
              lobbyId: "remote-r1",
              lobbyPhase: "LOBBY",
              hostName: "Host",
              hostPlayerId: "h1",
              playerCount: 1,
              maxPlayers: 8,
              createdAt: "2026-06-25T00:00:00.000Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { signToken } = await import("@/server/auth")
    const token = await signToken({ sub: "u1", username: "A" })
    vi.mocked(cookies).mockResolvedValueOnce({
      get: () => ({ value: token }),
    } as never)

    const res = await GET()

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      "http://realtime:3001/internal/lobbies",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    )
    await expect(res.json()).resolves.toEqual({
      lobbies: [
        {
          lobbyId: "remote-r1",
          lobbyPhase: "LOBBY",
          hostName: "Host",
          hostPlayerId: "h1",
          playerCount: 1,
          maxPlayers: 8,
          createdAt: "2026-06-25T00:00:00.000Z",
        },
      ],
      viewer: { isAdmin: false },
    })
  })

  it("returns 503 for web-only mode without realtime admin bridge config", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    vi.stubEnv("WW_SERVER_MODE", "web")
    const { signToken } = await import("@/server/auth")
    const token = await signToken({ sub: "u1", username: "A" })
    vi.mocked(cookies).mockResolvedValueOnce({
      get: () => ({ value: token }),
    } as never)

    const res = await GET()

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: "Realtime admin bridge not configured" })
  })

  it("passes realtime admin bridge errors through", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    vi.stubEnv("WW_REALTIME_ADMIN_URL", "http://realtime:3001")
    vi.stubEnv("WW_REALTIME_ADMIN_TOKEN", "secret")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "upstream unavailable" }), {
          status: 502,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
    const { signToken } = await import("@/server/auth")
    const token = await signToken({ sub: "u1", username: "A" })
    vi.mocked(cookies).mockResolvedValueOnce({
      get: () => ({ value: token }),
    } as never)

    const res = await GET()

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: "upstream unavailable" })
  })

  it("maps unexpected realtime admin bridge errors to unavailable", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    vi.resetModules()
    vi.doMock("@/server/realtime/adminClient", async () => {
      const actual = await vi.importActual<typeof import("@/server/realtime/adminClient")>(
        "@/server/realtime/adminClient",
      )
      return {
        ...actual,
        resolveRealtimeAdminConfig: () => ({
          url: "http://realtime:3001",
          token: "secret",
          timeoutMs: 2500,
        }),
        requestRealtimeAdmin: vi.fn().mockRejectedValue(new Error("boom")),
        isWebOnlyMode: () => false,
      }
    })
    const { GET: isolatedGET } = await import("./route")
    const { signToken } = await import("@/server/auth")
    const token = await signToken({ sub: "u1", username: "A" })
    vi.mocked(cookies).mockResolvedValueOnce({
      get: () => ({ value: token }),
    } as never)

    try {
      const res = await isolatedGET()

      expect(res.status).toBe(503)
      await expect(res.json()).resolves.toEqual({ error: "Realtime unavailable" })
    } finally {
      vi.doUnmock("@/server/realtime/adminClient")
      vi.resetModules()
    }
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
  })
})
