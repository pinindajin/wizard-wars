import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}))

vi.mock("@/server/db", () => ({
  prisma: prismaMock,
}))

import { POST } from "./route"

type MatchMakerMock = {
  getRoomById: ReturnType<typeof vi.fn>
  remoteRoomCall: ReturnType<typeof vi.fn>
}

function setMatchMaker(matchMaker?: MatchMakerMock): void {
  ;(globalThis as { __wizardWarsMatchMaker?: MatchMakerMock }).__wizardWarsMatchMaker = matchMaker
}

async function signedRequest(
  body: Record<string, unknown> = {},
  user = { sub: "u1", username: "Admin" },
): Promise<NextRequest> {
  vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
  const { signToken } = await import("@/server/auth")
  const token = await signToken(user)
  return new NextRequest("http://localhost/api/lobbies/r1/close", {
    method: "POST",
    headers: {
      cookie: `ww-token=${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/lobbies/[id]/close", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    prismaMock.user.findUnique.mockReset()
    setMatchMaker(undefined)
  })

  it("returns 401 without token", async () => {
    const req = new NextRequest("http://localhost/api/lobbies/r1/close", {
      method: "POST",
    })

    const res = await POST(req, { params: Promise.resolve({ id: "r1" }) })

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" })
  })

  it("returns 401 for invalid tokens", async () => {
    const req = new NextRequest("http://localhost/api/lobbies/r1/close", {
      method: "POST",
      headers: { cookie: "ww-token=not-a-valid-token" },
    })

    const res = await POST(req, { params: Promise.resolve({ id: "r1" }) })

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" })
  })

  it("clears cookie when protected user verification finds no DB user", async () => {
    vi.stubEnv("VERIFY_USER_ON_PROTECTED", "true")
    prismaMock.user.findUnique.mockResolvedValueOnce(null)

    const res = await POST(await signedRequest(), {
      params: Promise.resolve({ id: "r1" }),
    })

    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it("returns 403 for valid non-admin users", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Player",
      usernameLower: "player",
      isAdmin: false,
    })

    const res = await POST(await signedRequest(), {
      params: Promise.resolve({ id: "r1" }),
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" })
  })

  it("returns 503 when matchmaker is unavailable", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Admin",
      usernameLower: "admin",
      isAdmin: true,
    })

    const res = await POST(await signedRequest(), {
      params: Promise.resolve({ id: "r1" }),
    })

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: "Matchmaker unavailable" })
  })

  it("returns 404 when lobby is missing", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Admin",
      usernameLower: "admin",
      isAdmin: true,
    })
    setMatchMaker({
      getRoomById: vi.fn().mockResolvedValue(null),
      remoteRoomCall: vi.fn(),
    })

    const res = await POST(await signedRequest(), {
      params: Promise.resolve({ id: "r1" }),
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: "Lobby not found" })
  })

  it("returns 404 when lobby lookup fails", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Admin",
      usernameLower: "admin",
      isAdmin: true,
    })
    setMatchMaker({
      getRoomById: vi.fn().mockRejectedValue(new Error("not found")),
      remoteRoomCall: vi.fn(),
    })

    const res = await POST(await signedRequest(), {
      params: Promise.resolve({ id: "r1" }),
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: "Lobby not found" })
  })

  it("returns 409 when occupied lobby is not confirmed", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Admin",
      usernameLower: "admin",
      isAdmin: true,
    })
    setMatchMaker({
      getRoomById: vi.fn().mockResolvedValue({
        roomId: "r1",
        clients: 2,
        metadata: { lobbyPhase: "LOBBY", playerCount: 2 },
      }),
      remoteRoomCall: vi.fn(),
    })

    const res = await POST(await signedRequest(), {
      params: Promise.resolve({ id: "r1" }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: "confirmation_required",
      occupied: true,
      playerCount: 2,
      lobbyPhase: "LOBBY",
    })
  })

  it("forwards confirmed close requests to the realtime admin bridge when configured", async () => {
    vi.stubEnv("WW_REALTIME_ADMIN_URL", "http://realtime:3001")
    vi.stubEnv("WW_REALTIME_ADMIN_TOKEN", "secret")
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Admin",
      usernameLower: "admin",
      isAdmin: true,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "closing",
          occupied: true,
          closeAtServerMs: 12345,
          countdownMs: 30000,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const res = await POST(await signedRequest({ confirmed: true }), {
      params: Promise.resolve({ id: "r1" }),
    })

    expect(res.status).toBe(200)
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe("http://realtime:3001/internal/lobbies/r1/close")
    expect(call[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer secret" }),
    })
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({
      adminUserId: "u1",
      adminUsername: "Admin",
      confirmed: true,
    })
    await expect(res.json()).resolves.toEqual({
      status: "closing",
      occupied: true,
      closeAtServerMs: 12345,
      countdownMs: 30000,
    })
  })

  it("returns closed when admin closes an empty lobby", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Admin",
      usernameLower: "admin",
      isAdmin: true,
    })
    setMatchMaker({
      getRoomById: vi.fn().mockReturnValue({
        roomId: "r1",
        clients: 0,
        metadata: { lobbyPhase: "LOBBY", playerCount: 0 },
      }),
      remoteRoomCall: vi.fn().mockResolvedValue({
        status: "closed",
        occupied: false,
        closeAtServerMs: null,
      }),
    })

    const res = await POST(await signedRequest(), {
      params: Promise.resolve({ id: "r1" }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      status: "closed",
      occupied: false,
      closeAtServerMs: null,
    })
  })

  it("returns closing when admin confirms an occupied lobby", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Admin",
      usernameLower: "admin",
      isAdmin: true,
    })
    const remoteRoomCall = vi.fn().mockResolvedValue({
      status: "closing",
      occupied: true,
      closeAtServerMs: 12345,
      countdownMs: 30000,
    })
    setMatchMaker({
      getRoomById: vi.fn().mockResolvedValue({
        roomId: "r1",
        clients: 2,
        metadata: { lobbyPhase: "IN_PROGRESS", playerCount: 2 },
      }),
      remoteRoomCall,
    })

    const res = await POST(await signedRequest({ confirmed: true }), {
      params: Promise.resolve({ id: "r1" }),
    })

    expect(res.status).toBe(200)
    expect(remoteRoomCall).toHaveBeenCalledWith(
      "r1",
      "adminCloseLobby",
      [
        expect.objectContaining({
          adminUserId: "u1",
          confirmed: true,
        }),
      ],
    )
    await expect(res.json()).resolves.toEqual({
      status: "closing",
      occupied: true,
      closeAtServerMs: 12345,
      countdownMs: 30000,
    })
  })

  it("returns 409 when stale listing is empty but room reports occupied", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Admin",
      usernameLower: "admin",
      isAdmin: true,
    })
    setMatchMaker({
      getRoomById: vi.fn().mockResolvedValue({
        roomId: "r1",
        metadata: {},
      }),
      remoteRoomCall: vi.fn().mockResolvedValue({
        status: "confirmation_required",
        occupied: true,
        playerCount: 1,
        lobbyPhase: "COUNTDOWN",
      }),
    })

    const res = await POST(await signedRequest("not-json" as unknown as Record<string, unknown>), {
      params: Promise.resolve({ id: "r1" }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: "confirmation_required",
      occupied: true,
      playerCount: 1,
      lobbyPhase: "COUNTDOWN",
    })
  })

  it("returns 500 when remote room call fails", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Admin",
      usernameLower: "admin",
      isAdmin: true,
    })
    setMatchMaker({
      getRoomById: vi.fn().mockResolvedValue({
        roomId: "r1",
        clients: 0,
        metadata: { lobbyPhase: "LOBBY", playerCount: 0 },
      }),
      remoteRoomCall: vi.fn().mockRejectedValue(new Error("boom")),
    })

    const res = await POST(await signedRequest(), {
      params: Promise.resolve({ id: "r1" }),
    })

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: "Failed to close lobby" })
  })
})
