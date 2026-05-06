import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { matchMaker } from "@colyseus/core"
import type { Room } from "@colyseus/sdk"

import { RoomEvent } from "@/shared/roomEvents"
import type { LobbyStatePayload } from "@/shared/types"
import {
  GameLobbyRoom,
  playerLobbyIndex,
} from "@/server/colyseus/rooms/GameLobbyRoom"
import {
  bootTestServer,
  createTestToken,
  delay,
  shutdownTestServer,
  type TestServer,
} from "./helpers/colyseus-test-server"

/**
 * Waits for a polling condition to become true.
 *
 * @param cb - Condition callback.
 * @param options - Timeout options.
 */
async function waitFor(cb: () => boolean, options: { timeout: number }): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < options.timeout) {
    if (cb()) return
    await delay(25)
  }
  throw new Error(`Timed out waiting for condition after ${options.timeout}ms`)
}

/**
 * Returns a typed local game lobby room.
 *
 * @param roomId - Colyseus room id.
 * @returns Local GameLobbyRoom instance.
 */
function getLobbyRoom(roomId: string): GameLobbyRoom {
  const room = matchMaker.getLocalRoomById(roomId) as GameLobbyRoom | undefined
  if (!room) throw new Error(`Room ${roomId} not found`)
  return room
}

type BandwidthHookInspectable = {
  readonly bandwidthClientHooks: ReadonlyMap<unknown, unknown>
}

/**
 * Advances a lobby into IN_PROGRESS.
 *
 * @param hostRoom - Host SDK room.
 * @param guestRoom - Guest SDK room.
 */
async function startMatch(hostRoom: Room, guestRoom: Room): Promise<void> {
  let latestPhase = ""
  hostRoom.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
    latestPhase = state.phase
  })
  hostRoom.send(RoomEvent.LobbyStartGame, {})
  await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", { timeout: 5000 })
  hostRoom.send(RoomEvent.ClientSceneReady, {})
  guestRoom.send(RoomEvent.ClientSceneReady, {})
  await waitFor(() => latestPhase === "IN_PROGRESS", { timeout: 12_000 })
}

describe("lobby dashboard snapshots", { timeout: 30_000 }, () => {
  let server: TestServer
  let hostToken: string
  let guestToken: string

  beforeAll(async () => {
    server = await bootTestServer()
    hostToken = await createTestToken("dashboard-host", "Host")
    guestToken = await createTestToken("dashboard-guest", "Guest")
  })

  beforeEach(() => {
    playerLobbyIndex.clear()
  })

  afterAll(async () => {
    await shutdownTestServer(server)
  })

  it("returns roster, phase, host, counts, and bandwidth fields", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    const guestRoom = await server.sdk.joinById(hostRoom.roomId, { token: guestToken })

    const snapshot = getLobbyRoom(hostRoom.roomId).getAdminSnapshot()

    expect(snapshot).toMatchObject({
      snapshotAvailable: true,
      lobbyId: hostRoom.roomId,
      phase: "LOBBY",
      connectedPlayerCount: 2,
      rosterPlayerCount: 2,
      hostPlayerId: "dashboard-host",
      hostName: "Host",
    })
    expect(snapshot.players.map((player) => player.username)).toEqual(["Host", "Guest"])
    expect(snapshot.players.every((player) => player.connectionStatus === "connected")).toBe(true)
    expect(snapshot.bandwidth).toEqual({
      inboundBytes: expect.any(Number),
      outboundBytes: expect.any(Number),
      totalBytes: expect.any(Number),
    })

    await hostRoom.leave().catch(() => {})
    await guestRoom.leave().catch(() => {})
  })

  it("increments bandwidth when clients send and receive room messages", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    const before = getLobbyRoom(hostRoom.roomId).getAdminSnapshot().bandwidth.totalBytes

    hostRoom.send(RoomEvent.LobbyChat, { text: "dashboard bandwidth" })

    await waitFor(
      () => getLobbyRoom(hostRoom.roomId).getAdminSnapshot().bandwidth.totalBytes > before,
      { timeout: 5000 },
    )

    await hostRoom.leave().catch(() => {})
  })

  it("keeps disconnected players in the dashboard roster during reconnect grace", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    const guestRoom = await server.sdk.joinById(hostRoom.roomId, { token: guestToken })
    await startMatch(hostRoom, guestRoom)

    guestRoom.connection.close(4001, "network drop")

    await waitFor(() => {
      const guest = getLobbyRoom(hostRoom.roomId)
        .getAdminSnapshot()
        .players.find((player) => player.playerId === "dashboard-guest")
      return guest?.connectionStatus === "disconnected"
    }, { timeout: 5000 })

    await hostRoom.leave().catch(() => {})
  })

  it("removes bandwidth hooks when clients leave and the room disposes", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    const guestRoom = await server.sdk.joinById(hostRoom.roomId, { token: guestToken })
    const room = getLobbyRoom(hostRoom.roomId) as GameLobbyRoom & BandwidthHookInspectable

    expect(room.bandwidthClientHooks.size).toBe(2)

    await guestRoom.leave().catch(() => {})
    await waitFor(() => room.bandwidthClientHooks.size === 1, { timeout: 5000 })

    await hostRoom.leave().catch(() => {})
    await waitFor(() => room.bandwidthClientHooks.size === 0, { timeout: 5000 })
  })
})
