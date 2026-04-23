import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
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

async function waitFor(cb: () => boolean, options: { timeout: number }): Promise<void> {
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

describe(
  "PlayerInput queue ordering and lastProcessedInputSeq",
  { timeout: 30_000 },
  () => {
    let server: TestServer
    let hostToken: string
    let hostRoom: Room

    beforeAll(async () => {
      server = await bootTestServer()
      hostToken = await createTestToken("user-host-seq", "SeqHost")
    })

    beforeEach(() => {
      playerLobbyIndex.clear()
    })

    afterAll(async () => {
      await shutdownTestServer(server)
    })

    it(
      "consumes inputs in seq order and acks lastProcessedInputSeq monotonically",
      async () => {
        hostRoom = await server.sdk.create("game_lobby", { token: hostToken })

        let latestPhase = ""
        hostRoom.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
          latestPhase = state.phase
        })

        let gameSync: GameStateSyncPayload | null = null
        hostRoom.onMessage(RoomEvent.GameStateSync, (p: GameStateSyncPayload) => {
          gameSync = p
        })

        const acks: number[] = []
        hostRoom.onMessage(
          RoomEvent.PlayerBatchUpdate,
          (p: PlayerBatchUpdatePayload) => {
            for (const d of p.deltas) {
              if (d.lastProcessedInputSeq !== undefined) {
                acks.push(d.lastProcessedInputSeq)
              }
            }
          },
        )

        hostRoom.send(RoomEvent.LobbyStartGame, {})
        await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", { timeout: 5000 })
        hostRoom.send(RoomEvent.ClientSceneReady, {})
        await waitFor(
          () => gameSync != null && latestPhase === "IN_PROGRESS",
          { timeout: 12_000 },
        )

        // Fire five inputs as fast as possible with sequential seq numbers.
        const SEQS = [1, 2, 3, 4, 5]
        for (const s of SEQS) {
          hostRoom.send(RoomEvent.PlayerInput, { ...baseInput(s), up: true })
        }

        // Let ~20 server ticks (~333 ms at 60 Hz) process all five.
        await delay(400)

        // All five seqs must appear in the observed acks, in non-decreasing
        // order, and the highest must be at least 5.
        expect(acks.length).toBeGreaterThan(0)
        for (let i = 1; i < acks.length; i++) {
          expect(acks[i]).toBeGreaterThanOrEqual(acks[i - 1]!)
        }
        expect(Math.max(...acks)).toBe(5)
      },
    )

    it("ignores inputs with seq <= previously accepted", async () => {
      const user2Token = await createTestToken("user-host-seq-2", "SeqHost2")
      const room2 = await server.sdk.create("game_lobby", { token: user2Token })

      let latestPhase = ""
      room2.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
        latestPhase = state.phase
      })

      let gameSync: GameStateSyncPayload | null = null
      room2.onMessage(RoomEvent.GameStateSync, (p: GameStateSyncPayload) => {
        gameSync = p
      })

      const acks: number[] = []
      room2.onMessage(RoomEvent.PlayerBatchUpdate, (p: PlayerBatchUpdatePayload) => {
        for (const d of p.deltas) {
          if (d.lastProcessedInputSeq !== undefined) acks.push(d.lastProcessedInputSeq)
        }
      })

      room2.send(RoomEvent.LobbyStartGame, {})
      await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", { timeout: 5000 })
      room2.send(RoomEvent.ClientSceneReady, {})
      await waitFor(
        () => gameSync != null && latestPhase === "IN_PROGRESS",
        { timeout: 12_000 },
      )

      room2.send(RoomEvent.PlayerInput, { ...baseInput(10), up: true })
      await delay(100)
      // Stale seqs (5, 7) must be ignored.
      room2.send(RoomEvent.PlayerInput, { ...baseInput(5), up: true })
      room2.send(RoomEvent.PlayerInput, { ...baseInput(7), up: true })
      room2.send(RoomEvent.PlayerInput, { ...baseInput(11), up: true })
      await delay(300)

      expect(Math.max(...acks)).toBe(11)
      expect(acks.some((v) => v < 10)).toBe(false)
    })
  },
)
