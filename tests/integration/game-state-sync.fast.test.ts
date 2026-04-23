import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { RoomEvent } from "@/shared/roomEvents"
import {
  bootTestServer,
  createTestToken,
  delay,
  shutdownTestServer,
  type TestServer,
} from "./helpers/colyseus-test-server"
import { playerLobbyIndex } from "@/server/colyseus/rooms/GameLobbyRoom"
import type { GameStateSyncPayload, LobbyStatePayload } from "@/shared/types"
import type { Room } from "@colyseus/sdk"

async function waitFor(cb: () => boolean, options: { timeout: number }): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < options.timeout) {
    if (cb()) return
    await delay(50)
  }
  throw new Error(`Timed out after ${options.timeout}ms`)
}

describe("game_state_sync on match start", { timeout: 30_000 }, () => {
  let server: TestServer
  let hostToken: string
  let hostRoom: Room

  beforeAll(async () => {
    server = await bootTestServer()
    hostToken = await createTestToken("user-host", "HostOnly")
  })

  beforeEach(() => {
    playerLobbyIndex.clear()
  })

  afterAll(async () => {
    await shutdownTestServer(server)
  })

  it("broadcasts GameStateSync with seq 0 after MatchGo (single player)", async () => {
    hostRoom = await server.sdk.create("game_lobby", { token: hostToken })

    let latestPhase = ""
    hostRoom.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
      latestPhase = state.phase
    })

    let gameSync: GameStateSyncPayload | null = null
    hostRoom.onMessage(RoomEvent.GameStateSync, (p: GameStateSyncPayload) => {
      gameSync = p
    })

    hostRoom.send(RoomEvent.LobbyStartGame, {})
    await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", { timeout: 5000 })

    hostRoom.send(RoomEvent.ClientSceneReady, {})
    await waitFor(
      () => gameSync != null && latestPhase === "IN_PROGRESS",
      { timeout: 12_000 },
    )

    expect(gameSync).not.toBeNull()
    if (!gameSync) return
    expect(gameSync.seq).toBe(0)
    expect(gameSync.fireballs).toEqual([])
    expect(gameSync.players.length).toBe(1)
    expect(gameSync.players[0]!.playerId).toBe("user-host")
    expect(typeof gameSync.players[0]!.id).toBe("number")
    expect(gameSync.players[0]!.invulnerable).toBeTypeOf("boolean")
    expect(gameSync.players[0]!.animState).toBe("idle")

    // New fields added in the smooth-movement overhaul.
    expect(gameSync.serverTimeMs).toBeGreaterThan(0)
    expect(gameSync.players[0]!.vx).toBe(0)
    expect(gameSync.players[0]!.vy).toBe(0)
    expect(gameSync.players[0]!.moveState).toBe("idle")
    expect(typeof gameSync.players[0]!.lastProcessedInputSeq).toBe("number")
  })

  it("guest rejoin during IN_PROGRESS receives GameStateSync with all sim players", async () => {
    const guestToken = await createTestToken("user-guest", "GuestPlayer")
    const hostRoomLocal = await server.sdk.create("game_lobby", { token: hostToken })
    const guestRoomLocal = await server.sdk.joinById(hostRoomLocal.roomId, { token: guestToken })

    let latestPhase = ""
    hostRoomLocal.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
      latestPhase = state.phase
    })

    hostRoomLocal.send(RoomEvent.LobbyStartGame, {})
    await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", { timeout: 5000 })

    hostRoomLocal.send(RoomEvent.ClientSceneReady, {})
    guestRoomLocal.send(RoomEvent.ClientSceneReady, {})
    await waitFor(() => latestPhase === "IN_PROGRESS", { timeout: 12_000 })

    await guestRoomLocal.leave()

    let rejoinSync: GameStateSyncPayload | null = null
    const guestAfterRejoin = await server.sdk.joinById(hostRoomLocal.roomId, { token: guestToken })
    guestAfterRejoin.onMessage(RoomEvent.GameStateSync, (p: GameStateSyncPayload) => {
      rejoinSync = p
    })

    await waitFor(() => rejoinSync != null, { timeout: 5000 })

    expect(rejoinSync!.players.length).toBe(2)
    expect(rejoinSync!.players.some((pl) => pl.playerId === "user-guest")).toBe(true)
    expect(rejoinSync!.players.some((pl) => pl.playerId === "user-host")).toBe(true)

    await guestAfterRejoin.leave().catch(() => {})
    await hostRoomLocal.leave().catch(() => {})
  })
})
