import { createServer } from "node:http"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { Client as ColyseusClient, type Room } from "@colyseus/sdk"

import { createColyseusServer, getColyseusWss } from "@/server/colyseus/app.config"
import { createRealtimeHttpApp } from "@/server/colyseus/realtime-server"
import { playerLobbyIndex } from "@/server/colyseus/rooms/GameLobbyRoom"

import {
  createTestToken,
  shutdownTestServer,
  type TestServer,
} from "./helpers/colyseus-test-server"

/**
 * Returns the port number the HTTP server is listening on.
 *
 * @param server - Realtime HTTP server.
 */
function assignedPort(server: TestServer["httpServer"]): number {
  const address = server.address()
  if (address && typeof address === "object") return address.port
  throw new Error("realtime test server did not bind a TCP port")
}

describe("standalone realtime process", { timeout: 30_000 }, () => {
  let server: TestServer
  let baseUrl: string

  beforeAll(async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    vi.stubEnv("WW_REALTIME_ADMIN_TOKEN", "secret")
    const httpServer = createServer(createRealtimeHttpApp())
    const gameServer = createColyseusServer(httpServer)
    await gameServer.listen(0, "127.0.0.1")
    const port = assignedPort(httpServer)
    baseUrl = `http://127.0.0.1:${port}`
    server = {
      gameServer,
      httpServer,
      wss: getColyseusWss(gameServer),
      sdk: new ColyseusClient(baseUrl.replace("http://", "ws://")),
      port,
    }
  })

  beforeEach(() => {
    playerLobbyIndex.clear()
  })

  afterAll(async () => {
    await shutdownTestServer(server)
    vi.unstubAllEnvs()
  })

  it("serves realtime health and readiness", async () => {
    await expect(fetch(`${baseUrl}/healthz`).then((res) => res.json())).resolves.toEqual({
      ok: true,
      role: "realtime",
    })
    await expect(fetch(`${baseUrl}/readyz`).then((res) => res.json())).resolves.toEqual({
      ok: true,
      role: "realtime",
    })
  })

  it("hosts chat, game_lobby, and internal lobby listing without Next", async () => {
    const token = await createTestToken("split-host", "SplitHost")
    const chat: Room = await server.sdk.joinOrCreate("chat", { token })
    const lobby: Room = await server.sdk.create("game_lobby", { token })

    const res = await fetch(`${baseUrl}/internal/lobbies`, {
      headers: { authorization: "Bearer secret" },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      lobbies: [
        {
          lobbyId: lobby.roomId,
          lobbyPhase: "LOBBY",
          hostName: "SplitHost",
          hostPlayerId: "split-host",
          playerCount: 1,
        },
      ],
    })

    await chat.leave().catch(() => {})
    await lobby.leave().catch(() => {})
  })
})
