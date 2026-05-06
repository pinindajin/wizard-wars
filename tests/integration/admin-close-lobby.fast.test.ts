import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { matchMaker } from "@colyseus/core"

import { RoomEvent } from "@/shared/roomEvents"
import {
  bootTestServer,
  createTestToken,
  delay,
  shutdownTestServer,
  type TestServer,
} from "./helpers/colyseus-test-server"
import {
  GameLobbyRoom,
  playerLobbyIndex,
  type AdminCloseLobbyResult,
} from "@/server/colyseus/rooms/GameLobbyRoom"
import type { LobbyStatePayload } from "@/shared/types"

async function waitFor(cb: () => boolean, options: { timeout: number }): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < options.timeout) {
    if (cb()) return
    await delay(25)
  }
  throw new Error(`Timed out waiting for condition after ${options.timeout}ms`)
}

function getLobbyRoom(roomId: string): GameLobbyRoom {
  const room = matchMaker.getLocalRoomById(roomId) as GameLobbyRoom | undefined
  if (!room) throw new Error(`Room ${roomId} not found`)
  return room
}

describe("admin close lobby", { timeout: 30_000 }, () => {
  let server: TestServer
  let hostToken: string
  let guestToken: string

  beforeAll(async () => {
    process.env.WIZARD_WARS_TEST_ADMIN_CLOSE_MS = "200"
    server = await bootTestServer()
    hostToken = await createTestToken("admin-close-host", "Host")
    guestToken = await createTestToken("admin-close-guest", "Guest")
  })

  beforeEach(() => {
    playerLobbyIndex.clear()
  })

  afterAll(async () => {
    delete process.env.WIZARD_WARS_TEST_ADMIN_CLOSE_MS
    await shutdownTestServer(server)
  })

  it("requires confirmation before closing an occupied lobby", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    const guestRoom = await server.sdk.joinById(hostRoom.roomId, { token: guestToken })
    const room = getLobbyRoom(hostRoom.roomId)

    const result = await room.adminCloseLobby({
      adminUserId: "admin",
      adminUsername: "Admin",
      confirmed: false,
    })

    expect(result).toEqual({
      status: "confirmation_required",
      occupied: true,
      playerCount: 2,
      lobbyPhase: "LOBBY",
    })
    expect(matchMaker.getLocalRoomById(hostRoom.roomId)).toBeDefined()

    await hostRoom.leave().catch(() => {})
    await guestRoom.leave().catch(() => {})
  })

  it("closes an empty lobby immediately", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    const roomId = hostRoom.roomId
    await hostRoom.leave().catch(() => {})
    await waitFor(() => getLobbyRoom(roomId).clients.length === 0, { timeout: 5000 })

    const result = await getLobbyRoom(roomId).adminCloseLobby({
      adminUserId: "admin",
      adminUsername: "Admin",
      confirmed: false,
    })

    expect(result).toEqual({
      status: "closed",
      occupied: false,
      closeAtServerMs: null,
    })
    await waitFor(() => matchMaker.getLocalRoomById(roomId) === undefined, { timeout: 5000 })
    expect(playerLobbyIndex.get("admin-close-host")).toBeUndefined()
  })

  it("broadcasts admin close and disposes occupied lobby after countdown", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    await server.sdk.joinById(hostRoom.roomId, { token: guestToken })
    const roomId = hostRoom.roomId

    const result = await getLobbyRoom(roomId).adminCloseLobby({
      adminUserId: "admin",
      adminUsername: "Admin",
      confirmed: true,
    })

    expect(result.status).toBe("closing")
    expect(result).toMatchObject({ occupied: true, countdownMs: 200 })
    await delay(600)
    expect(matchMaker.getLocalRoomById(roomId)).toBeUndefined()
    expect(playerLobbyIndex.get("admin-close-host")).toBeUndefined()
    expect(playerLobbyIndex.get("admin-close-guest")).toBeUndefined()
  })

  it("returns the existing closing status without duplicating close timers", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    const room = getLobbyRoom(hostRoom.roomId)

    const first = await room.adminCloseLobby({
      adminUserId: "admin",
      adminUsername: "Admin",
      confirmed: true,
    }) as Extract<AdminCloseLobbyResult, { status: "closing" }>
    const second = await room.adminCloseLobby({
      adminUserId: "admin",
      adminUsername: "Admin",
      confirmed: true,
    }) as Extract<AdminCloseLobbyResult, { status: "closing" }>

    expect(second).toEqual(first)
    await waitFor(() => matchMaker.getLocalRoomById(hostRoom.roomId) === undefined, { timeout: 5000 })
  })

  it("stops an in-progress match and cleans up room resources", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    let latestPhase = ""
    hostRoom.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
      latestPhase = state.phase
    })

    hostRoom.send(RoomEvent.LobbyStartGame, {})
    await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", { timeout: 5000 })
    hostRoom.send(RoomEvent.ClientSceneReady, {})
    await waitFor(() => latestPhase === "IN_PROGRESS", { timeout: 7000 })

    const room = getLobbyRoom(hostRoom.roomId)
    const result = await room.adminCloseLobby({
      adminUserId: "admin",
      adminUsername: "Admin",
      confirmed: true,
    })

    expect(result.status).toBe("closing")
    await waitFor(() => matchMaker.getLocalRoomById(hostRoom.roomId) === undefined, { timeout: 5000 })
    expect(playerLobbyIndex.get("admin-close-host")).toBeUndefined()
  })
})
