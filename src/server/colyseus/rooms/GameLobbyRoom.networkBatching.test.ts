import { afterEach, describe, expect, it, vi } from "vitest"

import { RoomEvent } from "@/shared/roomEvents"
import type { SimOutput } from "@/server/game/simulation"

import { GameLobbyRoom } from "./GameLobbyRoom"

function simOutput(overrides: Partial<SimOutput> = {}): SimOutput {
  return {
    playerDeltas: [],
    fireballDeltas: [],
    fireballRemovedIds: [],
    playerDeaths: [],
    playerRespawns: [],
    fireballLaunches: [],
    fireballImpacts: [],
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
