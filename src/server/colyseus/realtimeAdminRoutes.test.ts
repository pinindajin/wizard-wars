import { createServer, type Server as HttpServer } from "node:http"
import express from "express"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createRealtimeAdminRouter } from "./realtimeAdminRoutes"

type StartedServer = {
  readonly server: HttpServer
  readonly baseUrl: string
}

/**
 * Starts a small Express server with the realtime admin router installed.
 *
 * @param matchMaker - Matchmaker test double used by the router.
 * @param adminToken - Service token expected by internal routes.
 */
async function startRouterServer(
  matchMaker: NonNullable<Parameters<typeof createRealtimeAdminRouter>[0]>["matchMaker"],
  adminToken = "secret",
): Promise<StartedServer> {
  const app = express()
  app.use(express.json())
  app.use(
    createRealtimeAdminRouter({
      adminToken,
      matchMaker,
      now: () => new Date("2026-06-25T00:00:00.000Z"),
    }),
  )

  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind to a TCP port")
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

describe("realtime admin routes", () => {
  let started: StartedServer | null = null

  afterEach(async () => {
    if (!started) return
    await new Promise<void>((resolve) => started?.server.close(() => resolve()))
    started = null
  })

  it("serves health and readiness without service auth", async () => {
    started = await startRouterServer({
      query: vi.fn().mockResolvedValue([]),
      getRoomById: vi.fn(),
      remoteRoomCall: vi.fn(),
      getLocalRoomById: vi.fn(),
    })

    await expect(fetch(`${started.baseUrl}/healthz`).then((res) => res.json())).resolves.toEqual({
      ok: true,
      role: "realtime",
    })
    await expect(fetch(`${started.baseUrl}/readyz`).then((res) => res.json())).resolves.toEqual({
      ok: true,
      role: "realtime",
    })
  })

  it("requires bearer service auth for internal routes", async () => {
    started = await startRouterServer({
      query: vi.fn().mockResolvedValue([]),
      getRoomById: vi.fn(),
      remoteRoomCall: vi.fn(),
      getLocalRoomById: vi.fn(),
    })

    const missing = await fetch(`${started.baseUrl}/internal/lobbies`)
    const wrong = await fetch(`${started.baseUrl}/internal/lobbies`, {
      headers: { authorization: "Bearer nope" },
    })

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(403)
  })

  it("returns open lobby listings in the web route response shape", async () => {
    started = await startRouterServer({
      query: vi.fn().mockResolvedValue([
        {
          roomId: "r1",
          locked: false,
          clients: 2,
          createdAt: "2026-06-24T00:00:00.000Z",
          metadata: {
            lobbyPhase: "LOBBY",
            hostName: "Host",
            hostPlayerId: "h1",
            playerCount: 2,
            maxPlayers: 8,
          },
        },
        { roomId: "locked", locked: true, clients: 1, metadata: {} },
      ]),
      getRoomById: vi.fn(),
      remoteRoomCall: vi.fn(),
      getLocalRoomById: vi.fn(),
    })

    const res = await fetch(`${started.baseUrl}/internal/lobbies`, {
      headers: { authorization: "Bearer secret" },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      lobbies: [
        {
          lobbyId: "r1",
          lobbyPhase: "LOBBY",
          hostName: "Host",
          hostPlayerId: "h1",
          playerCount: 2,
          maxPlayers: 8,
          createdAt: "2026-06-24T00:00:00.000Z",
        },
      ],
    })
  })

  it("preserves close-lobby confirmation and success responses", async () => {
    const remoteRoomCall = vi.fn().mockResolvedValue({
      status: "closing",
      occupied: true,
      closeAtServerMs: 123,
      countdownMs: 30000,
    })
    started = await startRouterServer({
      query: vi.fn(),
      getRoomById: vi.fn().mockResolvedValue({
        roomId: "r1",
        clients: 2,
        metadata: { lobbyPhase: "COUNTDOWN", playerCount: 2 },
      }),
      remoteRoomCall,
      getLocalRoomById: vi.fn(),
    })

    const unconfirmed = await fetch(`${started.baseUrl}/internal/lobbies/r1/close`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ adminUserId: "admin", adminUsername: "Admin", confirmed: false }),
    })
    expect(unconfirmed.status).toBe(409)
    await expect(unconfirmed.json()).resolves.toEqual({
      error: "confirmation_required",
      occupied: true,
      playerCount: 2,
      lobbyPhase: "COUNTDOWN",
    })

    const confirmed = await fetch(`${started.baseUrl}/internal/lobbies/r1/close`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ adminUserId: "admin", adminUsername: "Admin", confirmed: true }),
    })
    expect(confirmed.status).toBe(200)
    expect(remoteRoomCall).toHaveBeenCalledWith("r1", "adminCloseLobby", [
      { adminUserId: "admin", adminUsername: "Admin", confirmed: true },
    ])
    await expect(confirmed.json()).resolves.toEqual({
      status: "closing",
      occupied: true,
      closeAtServerMs: 123,
      countdownMs: 30000,
    })
  })

  it("returns dashboard snapshots in the dev dashboard response shape", async () => {
    started = await startRouterServer({
      query: vi.fn().mockResolvedValue([{ roomId: "r1", locked: false, clients: 1, metadata: {} }]),
      getRoomById: vi.fn(),
      remoteRoomCall: vi.fn(),
      getLocalRoomById: vi.fn().mockReturnValue({
        getAdminSnapshot: () => ({
          snapshotAvailable: true,
          lobbyId: "r1",
          phase: "LOBBY",
          createdAt: "2026-06-24T00:00:00.000Z",
          uptimeMs: 1000,
          connectedPlayerCount: 1,
          rosterPlayerCount: 1,
          maxPlayers: 12,
          hostPlayerId: "h1",
          hostName: "Host",
          bandwidth: { inboundBytes: 1, outboundBytes: 2, totalBytes: 3 },
          players: [],
        }),
      }),
    })

    const res = await fetch(`${started.baseUrl}/internal/dev/lobby-dashboard`, {
      headers: { authorization: "Bearer secret" },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      runtimeAvailable: true,
      viewer: { isAdmin: true },
      lobbies: [
        {
          snapshotAvailable: true,
          locked: false,
          lobbyId: "r1",
          bandwidth: { totalBytes: 3 },
        },
      ],
    })
  })
})
