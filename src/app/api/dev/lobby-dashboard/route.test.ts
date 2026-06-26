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

type MatchMakerMock = {
  readonly query: ReturnType<typeof vi.fn>
  readonly getLocalRoomById: ReturnType<typeof vi.fn>
}

/**
 * Installs a mock matchmaker on globalThis.
 *
 * @param matchMaker - Matchmaker mock or undefined.
 */
function setMatchMaker(matchMaker?: MatchMakerMock): void {
  ;(globalThis as { __wizardWarsMatchMaker?: MatchMakerMock }).__wizardWarsMatchMaker = matchMaker
}

/**
 * Mocks the Next cookie store for the route handler.
 *
 * @param token - Optional auth token value.
 */
function mockCookie(token?: string): void {
  vi.mocked(cookies).mockResolvedValueOnce({
    get: (name: string) => (token && name === "ww-token" ? { value: token } : undefined),
  } as never)
}

/**
 * Creates a signed test token.
 *
 * @returns Signed admin token.
 */
async function signedToken(): Promise<string> {
  vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
  const { signToken } = await import("@/server/auth")
  return signToken({ sub: "u1", username: "Admin" })
}

/**
 * Mocks an admin user lookup.
 */
function mockAdminUser(): void {
  prismaMock.user.findUnique.mockResolvedValueOnce({
    id: "u1",
    username: "Admin",
    usernameLower: "admin",
    isAdmin: true,
  })
}

describe("GET /api/dev/lobby-dashboard", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    prismaMock.user.findUnique.mockReset()
    setMatchMaker(undefined)
  })

  it("returns 401 without token", async () => {
    mockCookie()

    const res = await GET()

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" })
  })

  it("returns 403 for valid non-admin users", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Player",
      usernameLower: "player",
      isAdmin: false,
    })
    mockCookie(await signedToken())

    const res = await GET()

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" })
  })

  it("clears stale auth cookies when the token user no longer exists", async () => {
    vi.stubEnv("VERIFY_USER_ON_PROTECTED", "true")
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    mockCookie(await signedToken())

    const res = await GET()

    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toContain("ww-token=")
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" })
  })

  it("returns runtimeUnavailable when matchmaker is missing", async () => {
    mockAdminUser()
    mockCookie(await signedToken())

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      runtimeAvailable: false,
      viewer: { isAdmin: true },
      lobbies: [],
    })
  })

  it("returns runtimeUnavailable when matchmaker query fails", async () => {
    mockAdminUser()
    mockCookie(await signedToken())
    setMatchMaker({
      query: vi.fn().mockRejectedValue(new Error("matchmaker down")),
      getLocalRoomById: vi.fn(),
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      runtimeAvailable: false,
      lobbies: [],
    })
  })

  it("returns a degraded row when the local room is missing", async () => {
    mockAdminUser()
    mockCookie(await signedToken())
    setMatchMaker({
      query: vi.fn().mockResolvedValue([
        {
          roomId: "r1",
          locked: true,
          clients: 2,
          maxClients: 12,
          createdAt: "2026-05-06T00:00:00.000Z",
          metadata: {
            lobbyPhase: "IN_PROGRESS",
            hostName: "Host",
            hostPlayerId: "h1",
            playerCount: 2,
            maxPlayers: 12,
          },
        },
      ]),
      getLocalRoomById: vi.fn().mockReturnValue(undefined),
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.lobbies[0]).toMatchObject({
      snapshotAvailable: false,
      snapshotError: "local_room_missing",
      locked: true,
      lobbyId: "r1",
      phase: "IN_PROGRESS",
      connectedPlayerCount: 2,
      hostName: "Host",
      bandwidth: { inboundBytes: 0, outboundBytes: 0, totalBytes: 0 },
      players: [],
    })
  })

  it("uses realtime admin bridge when configured", async () => {
    vi.stubEnv("WW_REALTIME_ADMIN_URL", "http://realtime:3001")
    vi.stubEnv("WW_REALTIME_ADMIN_TOKEN", "secret")
    mockAdminUser()
    mockCookie(await signedToken())
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          generatedAt: "2026-06-25T00:00:00.000Z",
          runtimeAvailable: true,
          viewer: { isAdmin: true },
          lobbies: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET()

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      "http://realtime:3001/internal/dev/lobby-dashboard",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    )
    await expect(res.json()).resolves.toEqual({
      generatedAt: "2026-06-25T00:00:00.000Z",
      runtimeAvailable: true,
      viewer: { isAdmin: true },
      lobbies: [],
    })
  })

  it("passes realtime admin bridge errors through", async () => {
    vi.stubEnv("WW_REALTIME_ADMIN_URL", "http://realtime:3001")
    vi.stubEnv("WW_REALTIME_ADMIN_TOKEN", "secret")
    mockAdminUser()
    mockCookie(await signedToken())
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "upstream unavailable" }), {
          status: 502,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const res = await GET()

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: "upstream unavailable" })
  })

  it("returns 503 for web-only mode without realtime admin bridge config", async () => {
    vi.stubEnv("WW_SERVER_MODE", "web")
    mockAdminUser()
    mockCookie(await signedToken())

    const res = await GET()

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: "Realtime admin bridge not configured" })
  })

  it("uses local room snapshots when available", async () => {
    mockAdminUser()
    mockCookie(await signedToken())
    setMatchMaker({
      query: vi.fn().mockResolvedValue([{ roomId: "r1", locked: false, clients: 1, metadata: {} }]),
      getLocalRoomById: vi.fn().mockReturnValue({
        getAdminSnapshot: () => ({
          snapshotAvailable: true,
          lobbyId: "r1",
          phase: "LOBBY",
          createdAt: "2026-05-06T00:00:00.000Z",
          uptimeMs: 1000,
          connectedPlayerCount: 1,
          rosterPlayerCount: 1,
          maxPlayers: 12,
          hostPlayerId: "h1",
          hostName: "Host",
          bandwidth: { inboundBytes: 10, outboundBytes: 20, totalBytes: 30 },
          players: [
            {
              playerId: "h1",
              username: "Host",
              heroId: "red_wizard",
              isHost: true,
              isReady: false,
              clientSceneReady: false,
              connectionStatus: "connected",
              playStatus: "lobby_only",
              lastSeenAt: "2026-05-06T00:00:00.000Z",
            },
          ],
        }),
      }),
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.runtimeAvailable).toBe(true)
    expect(body.lobbies[0]).toMatchObject({
      snapshotAvailable: true,
      locked: false,
      lobbyId: "r1",
      bandwidth: { totalBytes: 30 },
    })
  })

  it("falls back to metadata when snapshot generation fails", async () => {
    mockAdminUser()
    mockCookie(await signedToken())
    setMatchMaker({
      query: vi.fn().mockResolvedValue([{ roomId: "r1", clients: 0, metadata: {} }]),
      getLocalRoomById: vi.fn().mockReturnValue({
        getAdminSnapshot: () => {
          throw new Error("boom")
        },
      }),
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.lobbies[0]).toMatchObject({
      snapshotAvailable: false,
      snapshotError: "snapshot_failed",
      lobbyId: "r1",
    })
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
    mockAdminUser()
    mockCookie(await signedToken())

    try {
      const res = await isolatedGET()

      expect(res.status).toBe(503)
      await expect(res.json()).resolves.toEqual({ error: "Realtime unavailable" })
    } finally {
      vi.doUnmock("@/server/realtime/adminClient")
      vi.resetModules()
    }
  })
})
