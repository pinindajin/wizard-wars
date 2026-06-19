import { afterEach, describe, expect, it, vi } from "vitest"

import { RoomEvent } from "@/shared/roomEvents"
import type { SimOutput } from "@/server/game/simulation"

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
