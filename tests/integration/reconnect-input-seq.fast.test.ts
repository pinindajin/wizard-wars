import { afterAll, beforeAll, beforeEach, describe, it } from "vitest"
import { RoomEvent } from "@/shared/roomEvents"
import { playerLobbyIndex } from "@/server/colyseus/rooms/GameLobbyRoom"
import type {
  GameStateSyncPayload,
  LobbyStatePayload,
  PlayerBatchUpdatePayload,
  PlayerInputPayload,
} from "@/shared/types"
import type { Room } from "@colyseus/sdk"

import {
  bootTestServer,
  createTestToken,
  delay,
  shutdownTestServer,
  type TestServer,
} from "./helpers/colyseus-test-server"

const GUEST_SUB = "user-guest-reconnect-seq0"

async function waitFor(
  cb: () => boolean,
  options: { timeout: number },
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < options.timeout) {
    if (cb()) return
    await delay(25)
  }
  throw new Error(`Timed out after ${options.timeout}ms`)
}

function baseInput(seq: number): PlayerInputPayload {
  return {
    up: false,
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

/**
 * Rejoining during IN_PROGRESS must accept `seq: 0` (browser refresh) after the
 * server used a high per-player input watermark.
 */
describe("Reconnect resets input seq (refresh)", { timeout: 30_000 }, () => {
  let server: TestServer
  let hostToken: string
  const hostId = "user-host-recon-seq0"

  beforeAll(async () => {
    server = await bootTestServer()
    hostToken = await createTestToken(hostId, "HostR")
  })

  beforeEach(() => {
    playerLobbyIndex.clear()
  })

  afterAll(async () => {
    await shutdownTestServer(server)
  })

  it("guest leave + rejoin after many inputs: seq 0 is acked", async () => {
    const guestToken = await createTestToken(GUEST_SUB, "GuestR")
    const hostRoom = await server.sdk.create("game_lobby", { token: hostToken })
    const guestRoom = await server.sdk.joinById(hostRoom.roomId, { token: guestToken })

    let latestPhase = ""
    hostRoom.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
      latestPhase = state.phase
    })

    hostRoom.send(RoomEvent.LobbyStartGame, {})
    await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", { timeout: 5000 })
    hostRoom.send(RoomEvent.ClientSceneReady, {})
    guestRoom.send(RoomEvent.ClientSceneReady, {})
    await waitFor(() => latestPhase === "IN_PROGRESS", { timeout: 12_000 })

    for (let s = 1; s <= 60; s++) {
      guestRoom.send(RoomEvent.PlayerInput, { ...baseInput(s), up: true })
    }
    await delay(500)

    await guestRoom.leave().catch(() => {})

    let guestEid: number | null = null
    let sawAck0 = false
    const guest2 = await server.sdk.joinById(hostRoom.roomId, { token: guestToken })
    guest2.onMessage(RoomEvent.GameStateSync, (p: GameStateSyncPayload) => {
      const me = p.players.find((pl) => pl.playerId === GUEST_SUB)
      if (me) guestEid = me.id
    })
    guest2.onMessage(RoomEvent.PlayerBatchUpdate, (p: PlayerBatchUpdatePayload) => {
      for (const d of p.deltas) {
        if (
          guestEid != null &&
          d.id === guestEid &&
          d.lastProcessedInputSeq !== undefined &&
          d.lastProcessedInputSeq === 0
        ) {
          sawAck0 = true
        }
      }
    })
    guest2.send(RoomEvent.RequestResync, {})
    await waitFor(() => guestEid != null, { timeout: 5000 })

    guest2.send(RoomEvent.PlayerInput, { ...baseInput(0), up: true })
    await delay(200)
    await waitFor(() => sawAck0, { timeout: 10_000 })

    await guest2.leave().catch(() => {})
    await hostRoom.leave().catch(() => {})
  })
})
