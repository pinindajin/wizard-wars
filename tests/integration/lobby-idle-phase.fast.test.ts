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
import type { LobbyStatePayload } from "@/shared/types"
import { playerLobbyIndex } from "@/server/colyseus/rooms/GameLobbyRoom"

async function waitFor(cb: () => boolean, options: { timeout: number }): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < options.timeout) {
    if (cb()) return
    await delay(50)
  }
  throw new Error(`Timed out waiting for condition after ${options.timeout}ms`)
}

describe("Lobby idle phase + payload", { timeout: 30_000 }, () => {
  let server: TestServer
  let hostToken: string

  beforeAll(async () => {
    process.env.WIZARD_WARS_TEST_LOBBY_IDLE_MS = "700"
    server = await bootTestServer()
    hostToken = await createTestToken("idle-host", "IdleHost")
  })

  beforeEach(() => {
    playerLobbyIndex.clear()
  })

  afterAll(async () => {
    delete process.env.WIZARD_WARS_TEST_LOBBY_IDLE_MS
    await shutdownTestServer(server)
  })

  it("LOBBY idle expires after test idle window (lobby_expired)", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    const roomId = hostRoom.roomId

    // Do not rely on `lobby_kicked` / client `onLeave`: the SDK clears handlers in its own
    // `onLeave` before user callbacks, and the socket may close before `lobby_kicked` is handled.
    await delay(900)
    await waitFor(() => matchMaker.getLocalRoomById(roomId) === undefined, { timeout: 10_000 })

    // Room may already be closed by the server; awaiting SDK `leave()` can hang waiting for `onLeave`.
    void hostRoom.leave().catch(() => {})
  })

  it("lobby state includes lobbyIdleExpiresAtServerMs in LOBBY", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })

    let last: LobbyStatePayload | null = null
    hostRoom.onMessage(RoomEvent.LobbyState, (s: LobbyStatePayload) => {
      last = s
    })

    await delay(200)
    expect(last).not.toBeNull()
    expect(last!.phase).toBe("LOBBY")
    expect(last!.lobbyIdleExpiresAtServerMs).toBeDefined()
    expect(last!.lobbyIdleExpiresAtServerMs!).toBeGreaterThan(Date.now())

    await hostRoom.leave().catch(() => {})
  })

  it("IN_PROGRESS is not ended by lobby idle after test window elapses", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })

    let latestPhase = ""
    hostRoom.onMessage(RoomEvent.LobbyState, (s: LobbyStatePayload) => {
      latestPhase = s.phase
    })

    hostRoom.send(RoomEvent.LobbyStartGame, {})
    await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", { timeout: 5000 })

    hostRoom.send(RoomEvent.ClientSceneReady, {})
    await waitFor(() => latestPhase === "COUNTDOWN", { timeout: 5000 })

    await delay(4500)
    expect(latestPhase).toBe("IN_PROGRESS")

    let kicked = false
    hostRoom.onMessage(RoomEvent.LobbyKicked, () => {
      kicked = true
    })

    await delay(2500)
    expect(latestPhase).toBe("IN_PROGRESS")
    expect(kicked).toBe(false)

    await hostRoom.leave().catch(() => {})
  })

  it("WAITING_FOR_CLIENTS lobby_state omits lobbyIdleExpiresAtServerMs", async () => {
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })

    let last: LobbyStatePayload | null = null
    hostRoom.onMessage(RoomEvent.LobbyState, (s: LobbyStatePayload) => {
      last = s
    })

    hostRoom.send(RoomEvent.LobbyStartGame, {})
    await waitFor(() => last?.phase === "WAITING_FOR_CLIENTS", { timeout: 5000 })
    expect(last!.lobbyIdleExpiresAtServerMs).toBeUndefined()

    await hostRoom.leave().catch(() => {})
  })
})
