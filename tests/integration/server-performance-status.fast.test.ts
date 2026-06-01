import { afterAll, beforeAll, beforeEach, describe, it } from "vitest"
import type { Room } from "@colyseus/sdk"

import { playerLobbyIndex } from "@/server/colyseus/rooms/GameLobbyRoom"
import { RoomEvent } from "@/shared/roomEvents"
import type {
  GameStateSyncPayload,
  LobbyStatePayload,
  PlayerInputPayload,
  ServerPerformanceStatusPayload,
} from "@/shared/types"

import {
  bootTestServer,
  createTestToken,
  delay,
  shutdownTestServer,
  type TestServer,
} from "./helpers/colyseus-test-server"

/**
 * Waits until the callback returns true or times out.
 *
 * @param cb - Predicate checked repeatedly.
 * @param timeout - Timeout in ms.
 */
async function waitFor(cb: () => boolean, timeout: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (cb()) return
    await delay(25)
  }
  throw new Error(`Timed out after ${timeout}ms`)
}

/**
 * Builds a minimal player input payload for room integration tests.
 *
 * @param seq - Client sequence number.
 * @returns Player input payload.
 */
function baseInput(seq: number): PlayerInputPayload {
  return {
    up: true,
    down: false,
    left: false,
    right: false,
    abilitySlot: null,
    abilityTargetX: 0,
    abilityTargetY: 0,
    weaponPrimary: false,
    weaponSecondary: false,
    weaponTargetX: 0,
    weaponTargetY: 0,
    useQuickItemSlot: null,
    seq,
    clientSendTimeMs: Date.now(),
  }
}

describe("server performance status", { timeout: 30_000 }, () => {
  let server: TestServer

  beforeAll(async () => {
    server = await bootTestServer()
  })

  beforeEach(() => {
    playerLobbyIndex.clear()
  })

  afterAll(async () => {
    await shutdownTestServer(server)
  })

  it("emits degraded status when input queue cap drops occur", async () => {
    const token = await createTestToken("perf-host", "PerfHost")
    const room: Room = await server.sdk.create("game_lobby", { token })
    const statuses: ServerPerformanceStatusPayload[] = []
    let latestPhase = ""
    let gameSync: GameStateSyncPayload | null = null

    room.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
      latestPhase = state.phase
    })
    room.onMessage(RoomEvent.GameStateSync, (payload: GameStateSyncPayload) => {
      gameSync = payload
    })
    room.onMessage(
      RoomEvent.ServerPerformanceStatus,
      (payload: ServerPerformanceStatusPayload) => {
        statuses.push(payload)
      },
    )

    room.send(RoomEvent.LobbyStartGame, {})
    await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", 5_000)
    room.send(RoomEvent.ClientSceneReady, {})
    await waitFor(() => gameSync !== null && latestPhase === "IN_PROGRESS", 12_000)

    for (let seq = 0; seq < 64; seq++) {
      room.send(RoomEvent.PlayerInput, baseInput(seq))
    }

    await waitFor(
      () =>
        statuses.some((status) =>
          status.reasons.includes("input_queue_drops"),
        ),
      4_000,
    )

    await room.leave()
  })
})
