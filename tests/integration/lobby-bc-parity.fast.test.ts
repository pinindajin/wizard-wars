import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { RoomEvent } from "@/shared/roomEvents"
import {
  bootTestServer,
  createTestToken,
  delay,
  shutdownTestServer,
  type TestServer,
} from "./helpers/colyseus-test-server"
import type { Room } from "@colyseus/sdk"
import type {
  LobbyStatePayload,
  LobbyHostTransferPayload,
  MatchCountdownStartPayload,
} from "@/shared/types"
import { playerLobbyIndex } from "@/server/colyseus/rooms/GameLobbyRoom"

/** Simple polling wait helper for integration messages. */
async function waitFor(cb: () => boolean, options: { timeout: number }): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < options.timeout) {
    if (cb()) return
    await delay(50)
  }
  throw new Error(`Timed out waiting for condition after ${options.timeout}ms`)
}

describe("Lobby BC feature parity integration", { timeout: 30_000 }, () => {
  let server: TestServer
  let hostToken: string
  let guestToken: string
  let hostRoom: Room
  let guestRoom: Room

  beforeAll(async () => {
    server = await bootTestServer()
    hostToken = await createTestToken("user-host", "HostPlayer")
    guestToken = await createTestToken("user-guest", "GuestPlayer")
  })

  beforeEach(() => {
    playerLobbyIndex.clear()
  })

  afterAll(async () => {
    await shutdownTestServer(server)
  })

  it("EndLobby: host can dissolve the lobby from LOBBY phase", async () => {
    hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    guestRoom = await server.sdk.joinById(hostRoom.roomId, { token: guestToken })

    let guestLeft = false
    guestRoom.onLeave((code) => {
      if (code === 4012 || code === 4002 || code === 1000) {
        guestLeft = true
      }
    })

    // Host sends EndLobby
    hostRoom.send(RoomEvent.LobbyEndLobby, {})

    await waitFor(() => guestLeft, { timeout: 10000 })
    expect(guestLeft).toBe(true)
  })

  it("EndLobby: host can cancel match countdown", async () => {
    hostRoom = await server.sdk.create("game_lobby", { token: hostToken })

    let latestPhase = ""
    hostRoom.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
      latestPhase = state.phase
    })

    guestRoom = await server.sdk.joinById(hostRoom.roomId, { token: guestToken })
    await delay(200)

    // Host starts game -> phase should become WAITING_FOR_CLIENTS
    hostRoom.send(RoomEvent.LobbyStartGame, {})
    await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", { timeout: 5000 })
    expect(latestPhase).toBe("WAITING_FOR_CLIENTS")

    // Both send scene ready -> phase should become COUNTDOWN
    hostRoom.send(RoomEvent.ClientSceneReady, {})
    guestRoom.send(RoomEvent.ClientSceneReady, {})
    await waitFor(() => latestPhase === "COUNTDOWN", { timeout: 5000 })
    expect(latestPhase).toBe("COUNTDOWN")

    // Host sends EndLobby during COUNTDOWN -> phase should return to LOBBY
    hostRoom.send(RoomEvent.LobbyEndLobby, {})
    await waitFor(() => latestPhase === "LOBBY", { timeout: 5000 })
    expect(latestPhase).toBe("LOBBY")
    
    // Clean up
    await hostRoom.leave().catch(() => {})
    await guestRoom.leave().catch(() => {})
  })

  it("MatchCountdownStart: broadcast after all clients scene-ready", async () => {
    hostRoom = await server.sdk.create("game_lobby", { token: hostToken })

    let latestPhase = ""
    hostRoom.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
      latestPhase = state.phase
    })

    let matchCountdown: MatchCountdownStartPayload | null = null
    hostRoom.onMessage(RoomEvent.MatchCountdownStart, (p: MatchCountdownStartPayload) => {
      matchCountdown = p
    })

    guestRoom = await server.sdk.joinById(hostRoom.roomId, { token: guestToken })
    await delay(200)

    hostRoom.send(RoomEvent.LobbyStartGame, {})
    await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", { timeout: 5000 })

    hostRoom.send(RoomEvent.ClientSceneReady, {})
    guestRoom.send(RoomEvent.ClientSceneReady, {})
    await waitFor(() => matchCountdown !== null, { timeout: 5000 })

    expect(matchCountdown).not.toBeNull()
    expect(matchCountdown!.startAtServerTimeMs).toBeGreaterThan(0)
    expect(matchCountdown!.durationMs).toBeGreaterThan(0)

    await hostRoom.leave().catch(() => {})
    await guestRoom.leave().catch(() => {})
  })

  it("LobbyHostTransfer: includes hostUsername in broadcast", async () => {
    hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    guestRoom = await server.sdk.joinById(hostRoom.roomId, { token: guestToken })
    await delay(200)

    let transferPayload: LobbyHostTransferPayload | null = null
    guestRoom.onMessage(RoomEvent.LobbyHostTransfer, (payload: LobbyHostTransferPayload) => {
      transferPayload = payload
    })

    // Host leaves -> guest should become host
    await hostRoom.leave()
    await waitFor(() => transferPayload !== null, { timeout: 5000 })

    expect(transferPayload).not.toBeNull()
    expect(transferPayload?.hostPlayerId).toBe("user-guest")
    expect(transferPayload?.hostUsername).toBe("GuestPlayer")
    
    await guestRoom.leave().catch(() => {})
  })

  it("RequestResync: returns LobbyState in IN_PROGRESS", async () => {
    hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    
    let latestPhase = ""
    hostRoom.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
      latestPhase = state.phase
    })

    await delay(100)

    // Force phase to IN_PROGRESS
    hostRoom.send(RoomEvent.LobbyStartGame, {})
    await delay(100)
    hostRoom.send(RoomEvent.ClientSceneReady, {})
    // MATCH_COUNTDOWN_DURATION_MS is 4000ms by default
    await delay(4500) 
    expect(latestPhase).toBe("IN_PROGRESS")

    let resyncReceived = false
    hostRoom.onMessage(RoomEvent.LobbyState, () => {
      resyncReceived = true
    })

    hostRoom.send(RoomEvent.RequestResync, {})
    await delay(200)
    expect(resyncReceived).toBe(true)

    await hostRoom.leave().catch(() => {})
  })
})
