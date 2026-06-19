import { afterEach, describe, expect, it, vi } from "vitest"

import { RoomEvent } from "@/shared/roomEvents"
import type { SimOutput } from "@/server/game/simulation"
import { createSessionEconomy } from "@/server/gameserver/sessionShop"

import { GameLobbyRoom } from "./GameLobbyRoom"

function simOutput(overrides: Partial<SimOutput> = {}): SimOutput {
  return {
    playerDeltas: [],
    fireballDeltas: [],
    fireballRemovedIds: [],
    homingOrbDeltas: [],
    homingOrbRemovedIds: [],
    playerDeaths: [],
    playerRespawns: [],
    fireballLaunches: [],
    fireballImpacts: [],
    homingOrbLaunches: [],
    homingOrbImpacts: [],
    lightningBolts: [],
    primaryMeleeAttacks: [],
    combatTelegraphStarts: [],
    combatTelegraphEnds: [],
    damageFloats: [],
    goldUpdates: [],
    abilitySfxEvents: [],
    matchEnded: null,
    ...overrides,
  }
}

describe("GameLobbyRoom network batching", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("broadcasts identical net timing in MatchGo and initial GameStateSync", () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    const client = {
      userData: {
        playerId: "player-1",
        username: "PlayerOne",
        heroId: "red_wizard",
      },
      send: vi.fn(),
    }
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [client],
    })
    Object.assign(room as object, {
      broadcast,
      updateMetadataPhase: vi.fn(),
    })

    ;(room as unknown as { startGame: () => void }).startGame()

    const matchGo = broadcast.mock.calls.find(([event]) => event === RoomEvent.MatchGo)?.[1]
    const sync = broadcast.mock.calls.find(([event]) => event === RoomEvent.GameStateSync)?.[1]
    expect(matchGo).toMatchObject({
      timing: {
        protocolVersion: 1,
        netSendRateHz: 30,
        netSendIntervalMs: 1000 / 30,
        remoteRenderDelayMs: 84,
      },
    })
    expect(sync).toMatchObject({ timing: matchGo.timing })

    ;(room as unknown as { gameLoopTimer: { clear: () => void } | null }).gameLoopTimer?.clear()
  })

  it("hydrates in-progress clients with net timing in GameStateSync", () => {
    vi.useFakeTimers()
    vi.setSystemTime(3_000)

    const room = new GameLobbyRoom()
    const client = {
      userData: {
        playerId: "player-1",
        username: "PlayerOne",
        heroId: "red_wizard",
      },
      send: vi.fn(),
    }
    Object.assign(room as object, {
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        buildGameStateSyncPayload: vi.fn((serverTimeMs: number) => ({
          players: [],
          fireballs: [],
          seq: 12,
          serverTimeMs,
        })),
      },
    })

    ;(
      room as unknown as {
        sendInProgressHydrationToClient: (target: typeof client) => void
      }
    ).sendInProgressHydrationToClient(client)

    expect(client.send).toHaveBeenCalledWith(RoomEvent.GameStateSync, {
      players: [],
      fireballs: [],
      seq: 12,
      serverTimeMs: 3_000,
      timing: {
        protocolVersion: 1,
        tickRateHz: 60,
        tickMs: 1000 / 60,
        netSendRateHz: 30,
        netSendIntervalMs: 1000 / 30,
        remoteRenderDelayMs: 84,
      },
    })
  })

  it("hydrates in-progress clients with current shop state when an economy exists", () => {
    vi.useFakeTimers()
    vi.setSystemTime(3_500)

    const room = new GameLobbyRoom()
    const client = {
      userData: {
        playerId: "player-1",
        username: "PlayerOne",
        heroId: "red_wizard",
      },
      send: vi.fn(),
    }
    const economy = createSessionEconomy()
    Object.assign(room as object, {
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        buildGameStateSyncPayload: vi.fn((serverTimeMs: number) => ({
          players: [],
          fireballs: [],
          seq: 13,
          serverTimeMs,
        })),
      },
    })
    ;(room as unknown as { economies: Map<string, typeof economy> }).economies.set(
      "player-1",
      economy,
    )

    ;(
      room as unknown as {
        sendInProgressHydrationToClient: (target: typeof client) => void
      }
    ).sendInProgressHydrationToClient(client)

    expect(client.send).toHaveBeenCalledWith(
      RoomEvent.ShopState,
      expect.objectContaining({ gold: economy.gold }),
    )
    expect(client.send).toHaveBeenCalledWith(
      RoomEvent.GameStateSync,
      expect.objectContaining({ seq: 13, serverTimeMs: 3_500 }),
    )
  })

  it("rejects building GameStateSync timing without an active simulation", () => {
    const room = new GameLobbyRoom()
    Object.assign(room as object, { simulation: null })

    expect(() =>
      (
        room as unknown as {
          buildGameStateSyncPayload: (serverTimeMs: number) => unknown
        }
      ).buildGameStateSyncPayload(1_000),
    ).toThrow("cannot build GameStateSync without an active simulation")
  })

  it("unicasts dedicated owner ACKs from sparse seq-only deltas without flushing visuals", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_010)

    const room = new GameLobbyRoom()
    const p1 = {
      userData: { playerId: "player-1" },
      send: vi.fn(),
    }
    const p2 = {
      userData: { playerId: "player-2" },
      send: vi.fn(),
    }
    const buildPlayerOwnerAckPayload = vi.fn(
      (id: number, lastProcessedInputSeq: number, serverTimeMs: number) => ({
        id,
        playerId: id === 1 ? "player-1" : "player-2",
        x: id === 1 ? 100 : 200,
        y: id === 1 ? 120 : 220,
        vx: 0,
        vy: 0,
        lastProcessedInputSeq,
        serverTimeMs,
        replayContext: {
          moveState: "idle",
          terrainState: "land",
          castingAbilityId: null,
          jumpZ: 0,
          jumpStartedInLava: false,
          isSwinging: false,
          hasSwiftBoots: false,
        },
      }),
    )
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [p1, p2],
    })
    Object.assign(room as object, {
      broadcast: vi.fn(),
      lobbyPhase: "IN_PROGRESS",
      lastNetworkFlushAtMs: 1_000,
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            playerDeltas: [
              { id: 1, lastProcessedInputSeq: 5 },
              { id: 2, lastProcessedInputSeq: 6 },
            ],
          }),
        ),
        entityPlayerMap: new Map([
          [1, "player-1"],
          [2, "player-2"],
        ]),
        buildPlayerOwnerAckPayload,
      },
    })

    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    expect(p1.send).toHaveBeenCalledWith(RoomEvent.PlayerOwnerAck, {
      id: 1,
      playerId: "player-1",
      x: 100,
      y: 120,
      vx: 0,
      vy: 0,
      lastProcessedInputSeq: 5,
      serverTimeMs: 1_010,
      replayContext: {
        moveState: "idle",
        terrainState: "land",
        castingAbilityId: null,
        jumpZ: 0,
        jumpStartedInLava: false,
        isSwinging: false,
        hasSwiftBoots: false,
      },
    })
    expect(p2.send).toHaveBeenCalledWith(RoomEvent.PlayerOwnerAck, {
      id: 2,
      playerId: "player-2",
      x: 200,
      y: 220,
      vx: 0,
      vy: 0,
      lastProcessedInputSeq: 6,
      serverTimeMs: 1_010,
      replayContext: {
        moveState: "idle",
        terrainState: "land",
        castingAbilityId: null,
        jumpZ: 0,
        jumpStartedInLava: false,
        isSwinging: false,
        hasSwiftBoots: false,
      },
    })
    expect(p1.send).not.toHaveBeenCalledWith(
      RoomEvent.PlayerOwnerAck,
      expect.objectContaining({ playerId: "player-2" }),
    )
    expect(p2.send).not.toHaveBeenCalledWith(
      RoomEvent.PlayerOwnerAck,
      expect.objectContaining({ playerId: "player-1" }),
    )
    expect((room as unknown as { broadcast: ReturnType<typeof vi.fn> }).broadcast).not.toHaveBeenCalledWith(
      RoomEvent.PlayerBatchUpdate,
      expect.anything(),
    )
  })

  it("skips owner ACK deltas without an ACK cursor or sample payload", () => {
    const room = new GameLobbyRoom()
    const client = {
      userData: { playerId: "player-1" },
      send: vi.fn(),
    }
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [client],
    })
    Object.assign(room as object, {
      simulation: {
        entityPlayerMap: new Map([[1, "player-1"]]),
        buildPlayerOwnerAckPayload: vi.fn(() => null),
      },
    })

    ;(
      room as unknown as {
        sendOwnerAckDeltas: (
          deltas: Array<{ id: number; lastProcessedInputSeq?: number }>,
          serverTimeMs: number,
        ) => void
      }
    ).sendOwnerAckDeltas([{ id: 1 }, { id: 1, lastProcessedInputSeq: 3 }], 1_000)

    expect(client.send).not.toHaveBeenCalled()
  })

  it("flushes pending visual batches after cadence even when later ticks have no new output", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    const tick = vi
      .fn()
      .mockReturnValueOnce(simOutput({ fireballRemovedIds: [42] }))
      .mockReturnValueOnce(simOutput())

    Object.assign(room as object, {
      broadcast,
      lobbyPhase: "IN_PROGRESS",
      lastNetworkFlushAtMs: 1_000,
      simulation: {
        tick,
        entityPlayerMap: new Map(),
      },
    })

    ;(room as unknown as { runGameTick: () => void }).runGameTick()
    expect(broadcast).not.toHaveBeenCalledWith(
      RoomEvent.FireballBatchUpdate,
      expect.anything(),
    )

    vi.setSystemTime(1_040)
    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.FireballBatchUpdate, {
      deltas: [],
      removedIds: [42],
      seq: 0,
    })
  })
})
