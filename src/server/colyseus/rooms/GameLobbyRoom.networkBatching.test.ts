import { afterEach, describe, expect, it, vi } from "vitest"

import { RoomEvent } from "@/shared/roomEvents"
import { TICK_MS } from "@/shared/balance-config/rendering"
import { createGameSimulation, type SimOutput } from "@/server/game/simulation"
import {
  FireballVisualBatchCoalescer,
  HomingOrbVisualBatchCoalescer,
  PlayerVisualBatchCoalescer,
} from "@/server/game/networkBatching"
import { createSessionEconomy } from "@/server/gameserver/sessionShop"
import { logger } from "@/server/logger"
import { hasComponent } from "bitecs"
import {
  NeedsWorldCollisionResolution,
  Position,
  Velocity,
} from "@/server/game/components"

import {
  GameLobbyRoom,
  getActiveGameLoopRoomCountForDiagnostics,
} from "./GameLobbyRoom"
import { resolveGamePerformanceConfig } from "@/server/game/performanceConfig"

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

function abilityStates(charges: number) {
  return {
    fireball: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges,
      maxCharges: 3,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
  }
}

describe("GameLobbyRoom network batching", () => {
  const originalE2e = process.env.WIZARD_WARS_E2E
  const originalInputProtocol = process.env.WW_INPUT_PROTOCOL

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.env.WIZARD_WARS_E2E = originalE2e
    if (originalInputProtocol === undefined) {
      delete process.env.WW_INPUT_PROTOCOL
    } else {
      process.env.WW_INPUT_PROTOCOL = originalInputProtocol
    }
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
      input: {
        protocolVersion: 2,
        preferredTransport: "compact",
        activeHeartbeatMs: 100,
        idleHeartbeatMs: 1_000,
      },
    })
    expect(sync).toMatchObject({ timing: matchGo.timing })
    expect(sync).toMatchObject({ input: matchGo.input })

    ;(room as unknown as { gameLoopTimer: { clear: () => void } | null }).gameLoopTimer?.clear()
  })

  it("reports active game-loop room count for diagnostics", () => {
    const room = new GameLobbyRoom()
    Object.defineProperty(room, "roomId", {
      configurable: true,
      value: "diagnostic-room-count-test",
    })
    const initialCount = getActiveGameLoopRoomCountForDiagnostics()

    ;(
      room as unknown as {
        startGameLoop: (serverTimeMs: number) => void
        clearGameLoopTimer: () => void
      }
    ).startGameLoop(1_000)

    try {
      expect(getActiveGameLoopRoomCountForDiagnostics()).toBe(initialCount + 1)
    } finally {
      ;(
        room as unknown as {
          clearGameLoopTimer: () => void
        }
      ).clearGameLoopTimer()
    }
    expect(getActiveGameLoopRoomCountForDiagnostics()).toBe(initialCount)
  })

  it("advertises legacy input transport when the compact rollout env is disabled", () => {
    process.env.WW_INPUT_PROTOCOL = "legacy"
    const room = new GameLobbyRoom()

    expect(
      (
        room as unknown as {
          buildGameInputProtocolPayload: () => unknown
        }
      ).buildGameInputProtocolPayload(),
    ).toEqual({
      protocolVersion: 1,
      preferredTransport: "legacy",
      activeHeartbeatMs: 100,
      idleHeartbeatMs: 1_000,
    })
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
      input: {
        protocolVersion: 2,
        preferredTransport: "compact",
        activeHeartbeatMs: 100,
        idleHeartbeatMs: 1_000,
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

  it("sends immediate GameStateSync with Swift Boots state after purchase", () => {
    vi.useFakeTimers()
    vi.setSystemTime(3_600)

    const room = new GameLobbyRoom()
    const client = {
      userData: {
        playerId: "player-1",
        username: "PlayerOne",
        heroId: "red_wizard",
      },
      send: vi.fn(),
    }
    const simulation = createGameSimulation(3_500)
    simulation.addPlayer("player-1", "PlayerOne", "red_wizard", 0)
    const economy = createSessionEconomy()
    Object.assign(room as object, {
      lobbyPhase: "IN_PROGRESS",
      simulation,
    })
    ;(room as unknown as { economies: Map<string, typeof economy> }).economies.set(
      "player-1",
      economy,
    )

    ;(
      room as unknown as {
        handleShopPurchase: (target: typeof client, payload: unknown) => void
      }
    ).handleShopPurchase(client, { itemId: "swift_boots" })

    expect(client.send).toHaveBeenCalledWith(
      RoomEvent.ShopState,
      expect.objectContaining({ augmentItemIds: ["swift_boots"] }),
    )
    expect(client.send).toHaveBeenCalledWith(
      RoomEvent.GameStateSync,
      expect.objectContaining({
        players: [
          expect.objectContaining({
            playerId: "player-1",
            hasSwiftBoots: true,
          }),
        ],
        serverTimeMs: 3_600,
      }),
    )
  })

  it("skips immediate GameStateSync outside an active simulation", () => {
    const room = new GameLobbyRoom()
    const client = { send: vi.fn() }
    Object.assign(room as object, {
      lobbyPhase: "LOBBY",
      simulation: {
        buildGameStateSyncPayload: vi.fn(),
      },
    })

    ;(
      room as unknown as {
        sendImmediateGameStateSyncToClient: (target: typeof client) => void
      }
    ).sendImmediateGameStateSyncToClient(client)

    Object.assign(room as object, {
      lobbyPhase: "IN_PROGRESS",
      simulation: null,
    })
    ;(
      room as unknown as {
        sendImmediateGameStateSyncToClient: (target: typeof client) => void
      }
    ).sendImmediateGameStateSyncToClient(client)

    expect(client.send).not.toHaveBeenCalled()
  })

  it("handles request_resync by sending lobby and current GameStateSync payloads", () => {
    vi.useFakeTimers()
    vi.setSystemTime(3_750)

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
          seq: 14,
          serverTimeMs,
        })),
      },
    })

    ;(
      room as unknown as {
        handleRequestResync: (target: typeof client) => void
      }
    ).handleRequestResync(client)

    expect(client.send).toHaveBeenCalledWith(
      RoomEvent.LobbyState,
      expect.objectContaining({ phase: "IN_PROGRESS" }),
    )
    expect(client.send).toHaveBeenCalledWith(
      RoomEvent.GameStateSync,
      expect.objectContaining({
        seq: 14,
        serverTimeMs: 3_750,
        input: expect.objectContaining({ preferredTransport: "compact" }),
      }),
    )
  })

  it("does not hydrate clients before the match is in progress", () => {
    const room = new GameLobbyRoom()
    const client = {
      userData: { playerId: "player-1" },
      send: vi.fn(),
    }
    Object.assign(room as object, {
      lobbyPhase: "LOBBY",
      simulation: {
        buildGameStateSyncPayload: vi.fn(),
      },
    })

    ;(
      room as unknown as {
        sendInProgressHydrationToClient: (
          target: typeof client,
          opts?: { readonly includeLobbyState?: boolean },
        ) => void
      }
    ).sendInProgressHydrationToClient(client, { includeLobbyState: true })

    expect(client.send).not.toHaveBeenCalled()
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

  it("unicasts dedicated owner ACKs without leaking ACK cursors into visual heartbeats", () => {
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
    const broadcast = vi.fn()
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
      broadcast,
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
    expect(broadcast).not.toHaveBeenCalledWith(
      RoomEvent.PlayerBatchUpdate,
      expect.anything(),
    )

    vi.setSystemTime(1_040)
    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    const playerBatchPayloads = broadcast.mock.calls
      .filter(([event]) => event === RoomEvent.PlayerBatchUpdate)
      .map(([, payload]) => payload)
    expect(playerBatchPayloads).toEqual([
      {
        deltas: [],
        removedIds: [],
        seq: 0,
        serverTimeMs: 1_040,
      },
    ])
    expect((room as unknown as { lastNetworkFlushAtMs: number }).lastNetworkFlushAtMs).toBe(1_040)
  })

  it("sends owner ACKs before visual coalescing handles player deltas", () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_010)

    const room = new GameLobbyRoom()
    const client = {
      userData: { playerId: "player-1" },
      send: vi.fn(),
    }
    const ingestPlayerVisuals = vi.fn()
    const buildPlayerOwnerAckPayload = vi.fn(
      (id: number, lastProcessedInputSeq: number, serverTimeMs: number) => ({
        id,
        playerId: "player-1",
        x: 10,
        y: 20,
        vx: 1,
        vy: 2,
        lastProcessedInputSeq,
        serverTimeMs,
        replayContext: {
          moveState: "moving",
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
      value: [client],
    })
    Object.assign(room as object, {
      broadcast: vi.fn(),
      lobbyPhase: "IN_PROGRESS",
      lastNetworkFlushAtMs: 2_000,
      playerVisualBatchCoalescer: {
        ingest: ingestPlayerVisuals,
        hasPending: () => false,
        flush: () => [],
        clear: () => undefined,
      },
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            playerDeltas: [{ id: 1, x: 10, lastProcessedInputSeq: 9 }],
          }),
        ),
        entityPlayerMap: new Map([[1, "player-1"]]),
        buildPlayerOwnerAckPayload,
      },
    })

    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    expect(client.send).toHaveBeenCalledWith(
      RoomEvent.PlayerOwnerAck,
      expect.objectContaining({ lastProcessedInputSeq: 9 }),
    )
    expect(buildPlayerOwnerAckPayload.mock.invocationCallOrder[0]).toBeLessThan(
      ingestPlayerVisuals.mock.invocationCallOrder[0]!,
    )
  })

  it("records critical send failures for owner ACK send errors", () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_020)

    const room = new GameLobbyRoom()
    const client = {
      userData: { playerId: "player-1" },
      send: vi.fn(() => {
        throw new Error("owner ack send failed")
      }),
    }
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [client],
    })
    Object.assign(room as object, {
      broadcast: vi.fn(),
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            playerDeltas: [{ id: 1, x: 10, lastProcessedInputSeq: 9 }],
          }),
        ),
        entityPlayerMap: new Map([[1, "player-1"]]),
        buildPlayerOwnerAckPayload: vi.fn(() => ({
          id: 1,
          playerId: "player-1",
          x: 10,
          y: 20,
          vx: 1,
          vy: 2,
          lastProcessedInputSeq: 9,
          serverTimeMs: 2_020,
          replayContext: {
            moveState: "moving",
            terrainState: "land",
            castingAbilityId: null,
            jumpZ: 0,
            jumpStartedInLava: false,
            isSwinging: false,
            hasSwiftBoots: false,
          },
        })),
      },
    })

    expect(() =>
      (room as unknown as { runGameTick: () => void }).runGameTick(),
    ).toThrow("owner ack send failed")
    expect(
      (room as unknown as { performanceCriticalSendFailures: number })
        .performanceCriticalSendFailures,
    ).toBe(1)
  })

  it("records critical send failures for immediate broadcast errors", () => {
    const room = new GameLobbyRoom()
    const damageFloat = {
      targetId: "player-2",
      attackerUserId: "player-1",
      amount: 8,
      x: 100,
      y: 120,
    }
    const broadcast = vi.fn((event: string) => {
      if (event === RoomEvent.DamageFloat) {
        throw new Error("damage float broadcast failed")
      }
    })
    Object.assign(room as object, {
      broadcast,
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            damageFloats: [damageFloat],
          }),
        ),
        entityPlayerMap: new Map(),
      },
    })

    expect(() =>
      (room as unknown as { runGameTick: () => void }).runGameTick(),
    ).toThrow("damage float broadcast failed")
    expect(
      (room as unknown as { performanceCriticalSendFailures: number })
        .performanceCriticalSendFailures,
    ).toBe(1)
  })

  it("records critical send failures for semantic player budget broadcasts", () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_040)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn((event: string) => {
      if (event === RoomEvent.PlayerBatchUpdate) {
        throw new Error("semantic batch broadcast failed")
      }
    })
    Object.assign(room as object, {
      broadcast,
      lobbyPhase: "IN_PROGRESS",
      performanceConfig: resolveGamePerformanceConfig({
        WW_NET_SEND_BUDGET_ENABLED: "true",
      }),
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            playerDeltas: [{ id: 1, health: 70 }],
          }),
        ),
        entityPlayerMap: new Map(),
      },
    })

    expect(() =>
      (room as unknown as { runGameTick: () => void }).runGameTick(),
    ).toThrow("semantic batch broadcast failed")
    expect(
      (room as unknown as { performanceCriticalSendFailures: number })
        .performanceCriticalSendFailures,
    ).toBe(1)
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

  it("skips owner ACK deltas without a live simulation or owner client", () => {
    const room = new GameLobbyRoom()
    ;(
      room as unknown as {
        sendOwnerAckDeltas: (
          deltas: Array<{ id: number; lastProcessedInputSeq?: number }>,
          serverTimeMs: number,
        ) => void
      }
    ).sendOwnerAckDeltas([{ id: 1, lastProcessedInputSeq: 3 }], 1_000)

    const buildPlayerOwnerAckPayload = vi.fn(() => ({
      id: 1,
      playerId: "missing-player",
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      lastProcessedInputSeq: 3,
      serverTimeMs: 1_000,
      replayContext: {
        moveState: "idle",
        terrainState: "land",
        castingAbilityId: null,
        jumpZ: 0,
        jumpStartedInLava: false,
        isSwinging: false,
        hasSwiftBoots: false,
      },
    }))
    Object.assign(room as object, {
      simulation: {
        entityPlayerMap: new Map([[1, "missing-player"]]),
        buildPlayerOwnerAckPayload,
      },
    })

    ;(
      room as unknown as {
        sendOwnerAckDeltas: (
          deltas: Array<{ id: number; lastProcessedInputSeq?: number }>,
          serverTimeMs: number,
        ) => void
      }
    ).sendOwnerAckDeltas([{ id: 1, lastProcessedInputSeq: 3 }], 1_000)

    expect(buildPlayerOwnerAckPayload).not.toHaveBeenCalled()

    Object.assign(room as object, {
      simulation: {
        entityPlayerMap: new Map(),
        buildPlayerOwnerAckPayload,
      },
    })
    ;(
      room as unknown as {
        sendOwnerAckDeltas: (
          deltas: Array<{ id: number; lastProcessedInputSeq?: number }>,
          serverTimeMs: number,
        ) => void
      }
    ).sendOwnerAckDeltas([{ id: 2, lastProcessedInputSeq: 4 }], 1_100)

    expect(buildPlayerOwnerAckPayload).not.toHaveBeenCalled()
  })

  it("marks E2E forced player positions for world collision repair", () => {
    process.env.WIZARD_WARS_E2E = "1"
    const room = new GameLobbyRoom()
    const simulation = createGameSimulation(1_000)
    const eid = simulation.addPlayer("player-1", "PlayerOne", "red_wizard", 0)
    const client = {
      userData: { playerId: "player-1" },
      send: vi.fn(),
    }
    Object.assign(room as object, {
      lobbyPhase: "IN_PROGRESS",
      simulation,
    })

    ;(
      room as unknown as {
        handleE2eSetPlayerPosition: (target: typeof client, payload: unknown) => void
      }
    ).handleE2eSetPlayerPosition(client, { x: 222, y: 333 })

    expect(Position.x[eid]).toBe(222)
    expect(Position.y[eid]).toBe(333)
    expect(Velocity.vx[eid]).toBe(0)
    expect(Velocity.vy[eid]).toBe(0)
    expect(hasComponent(simulation.world, eid, NeedsWorldCollisionResolution)).toBe(true)
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
      serverTimeMs: 1_000,
    })
  })

  it("flushes snapshotted player visual batches after a quiet cadence tick", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    const playerDelta = {
      id: 1,
      x: 10,
      abilityStates: abilityStates(2),
      lastProcessedInputSeq: 7,
    }
    const tick = vi
      .fn()
      .mockReturnValueOnce(simOutput({ playerDeltas: [playerDelta] }))
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
    playerDelta.x = 999
    playerDelta.abilityStates.fireball.charges = 0
    expect(broadcast).not.toHaveBeenCalledWith(
      RoomEvent.PlayerBatchUpdate,
      expect.anything(),
    )

    vi.setSystemTime(1_040)
    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.PlayerBatchUpdate, {
      deltas: [
        {
          id: 1,
          x: 10,
          abilityStates: abilityStates(2),
        },
      ],
      removedIds: [],
      seq: 0,
      serverTimeMs: 1_040,
    })
  })

  it("keeps a reused fireball id delta when removal and relaunch coalesce before flush", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    const reusedDelta = { id: 42, x: 10, y: 20 }
    const tick = vi
      .fn()
      .mockReturnValueOnce(simOutput({ fireballRemovedIds: [42] }))
      .mockReturnValueOnce(simOutput({ fireballDeltas: [reusedDelta] }))
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
    vi.setSystemTime(1_010)
    ;(room as unknown as { runGameTick: () => void }).runGameTick()
    reusedDelta.x = 999
    expect(broadcast).not.toHaveBeenCalledWith(
      RoomEvent.FireballBatchUpdate,
      expect.anything(),
    )

    vi.setSystemTime(1_040)
    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.FireballBatchUpdate, {
      deltas: [{ id: 42, x: 10, y: 20 }],
      removedIds: [],
      seq: 0,
      serverTimeMs: 1_010,
    })
  })

  it("flushes snapshotted Homing Orb visual batches after a quiet cadence tick", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    const homingOrbDelta = {
      id: 77,
      x: 10,
      y: 20,
      vx: 1,
      vy: 2,
      headingRad: 0.5,
      targetId: "player-2",
    }
    const firstOutput = simOutput({
      homingOrbDeltas: [homingOrbDelta],
      homingOrbRemovedIds: [88],
    })
    const tick = vi
      .fn()
      .mockReturnValueOnce(firstOutput)
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
    homingOrbDelta.x = 999
    homingOrbDelta.targetId = "wrong-target"
    firstOutput.homingOrbRemovedIds[0] = 999
    expect(broadcast).not.toHaveBeenCalledWith(
      RoomEvent.HomingOrbBatchUpdate,
      expect.anything(),
    )

    vi.setSystemTime(1_040)
    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.HomingOrbBatchUpdate, {
      deltas: [
        {
          id: 77,
          x: 10,
          y: 20,
          vx: 1,
          vy: 2,
          headingRad: 0.5,
          targetId: "player-2",
        },
      ],
      removedIds: [88],
      seq: 0,
      serverTimeMs: 1_000,
    })
  })

  it("clears pending coalescer state with match runtime cleanup", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, { broadcast })
    ;(
      room as unknown as {
        playerVisualBatchCoalescer: PlayerVisualBatchCoalescer
        fireballVisualBatchCoalescer: FireballVisualBatchCoalescer
        homingOrbVisualBatchCoalescer: HomingOrbVisualBatchCoalescer
      }
    ).playerVisualBatchCoalescer.ingest([{ id: 1, x: 10 }])
    ;(
      room as unknown as {
        fireballVisualBatchCoalescer: FireballVisualBatchCoalescer
      }
    ).fireballVisualBatchCoalescer.ingest({
      deltas: [{ id: 2, x: 20, y: 30 }],
      removedIds: [],
      serverTimeMs: 2_000,
    })
    ;(
      room as unknown as {
        homingOrbVisualBatchCoalescer: HomingOrbVisualBatchCoalescer
      }
    ).homingOrbVisualBatchCoalescer.ingest({
      deltas: [{ id: 3, x: 40 }],
      removedIds: [],
      serverTimeMs: 2_000,
    })

    ;(room as unknown as { clearMatchRuntimeState: () => void })
      .clearMatchRuntimeState()
    ;(room as unknown as { flushPendingVisualBatches: (serverTimeMs: number) => void })
      .flushPendingVisualBatches(2_040)

    expect(broadcast).not.toHaveBeenCalledWith(
      RoomEvent.PlayerBatchUpdate,
      expect.anything(),
    )
    expect(broadcast).not.toHaveBeenCalledWith(
      RoomEvent.FireballBatchUpdate,
      expect.anything(),
    )
    expect(broadcast).not.toHaveBeenCalledWith(
      RoomEvent.HomingOrbBatchUpdate,
      expect.anything(),
    )
  })

  it("falls back to flush time when a pending fireball batch lacks serverTimeMs", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, { broadcast })
    ;(
      room as unknown as {
        fireballVisualBatchCoalescer: FireballVisualBatchCoalescer
      }
    ).fireballVisualBatchCoalescer.ingest({
      deltas: [{ id: 43, x: 1, y: 2 }],
      removedIds: [],
    })

    ;(room as unknown as { flushPendingVisualBatches: (serverTimeMs: number) => void })
      .flushPendingVisualBatches(3_000)

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.FireballBatchUpdate, {
      deltas: [{ id: 43, x: 1, y: 2 }],
      removedIds: [],
      seq: 0,
      serverTimeMs: 3_000,
    })
  })

  it("flushes pending player visual batches and records visual send duration", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, { broadcast })
    ;(
      room as unknown as {
        playerVisualBatchCoalescer: PlayerVisualBatchCoalescer
      }
    ).playerVisualBatchCoalescer.ingest([
      { id: 1, x: 10 },
      { id: 1, y: 20 },
    ])

    ;(room as unknown as { flushPendingVisualBatches: (serverTimeMs: number) => void })
      .flushPendingVisualBatches(3_250)

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.PlayerBatchUpdate, {
      deltas: [{ id: 1, x: 10, y: 20 }],
      removedIds: [],
      seq: 0,
      serverTimeMs: 3_250,
    })
    expect(
      (room as unknown as { performanceVisualFlushDurationMs: number })
        .performanceVisualFlushDurationMs,
    ).toBeGreaterThanOrEqual(0)
  })

  it("broadcasts damage floats and unicasts gold updates from tick output", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    const client = {
      userData: { playerId: "player-1" },
      send: vi.fn(),
    }
    const damageFloat = {
      targetId: "player-2",
      attackerUserId: "player-1",
      amount: 8,
      x: 100,
      y: 120,
    }
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [client],
    })
    Object.assign(room as object, {
      broadcast,
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            damageFloats: [damageFloat],
            goldUpdates: [
              { userId: "player-1", gold: 25 },
              { userId: "missing-player", gold: 50 },
            ],
          }),
        ),
        entityPlayerMap: new Map(),
      },
    })

    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.DamageFloat, damageFloat)
    expect(client.send).toHaveBeenCalledWith(RoomEvent.GoldBalance, { gold: 25 })
    expect(
      client.send.mock.calls.filter(([event]) => event === RoomEvent.GoldBalance),
    ).toHaveLength(1)
  })

  it("broadcasts immediate combat events and records immediate send duration", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    const client = {
      userData: { playerId: "player-1" },
      send: vi.fn(),
    }
    const fireballLaunch = {
      id: 1,
      ownerId: "player-1",
      x: 10,
      y: 20,
      vx: 30,
      vy: 40,
    }
    const fireballImpact = {
      id: 1,
      x: 11,
      y: 21,
      targetId: "player-2",
      damage: 8,
    }
    const homingOrbLaunch = {
      id: 2,
      ownerId: "player-1",
      targetId: "player-2",
      x: 20,
      y: 30,
      vx: 1,
      vy: 2,
      headingRad: 0.5,
      expiresAtServerTimeMs: 4_000,
    }
    const homingOrbImpact = {
      id: 2,
      x: 21,
      y: 31,
      reason: "hit" as const,
      targetId: "player-2",
      hitPlayerIds: ["player-2"],
      damage: 9,
    }
    const lightningBolt = {
      casterId: "player-1",
      originX: 1,
      originY: 2,
      targetX: 3,
      targetY: 4,
      seed: 123,
      hitPlayerIds: ["player-2"],
      damage: 12,
    }
    const primaryMeleeAttack = {
      casterId: "player-1",
      attackId: "primary",
      x: 5,
      y: 6,
      facingAngle: 0.25,
      damage: 4,
      hurtboxRadiusPx: 32,
      hurtboxArcDeg: 90,
      durationMs: 300,
      dangerousWindowStartMs: 50,
      dangerousWindowEndMs: 150,
    }
    const combatTelegraphStart = {
      id: "telegraph-1",
      casterId: "player-1",
      sourceId: "primary",
      anchor: "caster" as const,
      directionRad: 0.5,
      shape: { type: "cone" as const, radiusPx: 100, arcDeg: 80 },
      startsAtServerTimeMs: 1_000,
      dangerStartsAtServerTimeMs: 1_050,
      dangerEndsAtServerTimeMs: 1_150,
      endsAtServerTimeMs: 1_200,
    }
    const combatTelegraphEnd = {
      id: "telegraph-1",
      reason: "expired" as const,
    }
    const abilitySfx = { sfxKey: "fireball.launch" }
    const playerDeath = {
      playerId: "player-2",
      killerPlayerId: "player-1",
      killerAbilityId: "fireball",
      livesRemaining: 1,
      x: 100,
      y: 120,
    }
    const playerRespawn = {
      playerId: "player-2",
      spawnX: 200,
      spawnY: 220,
      facingAngle: 1.25,
    }
    const damageFloat = {
      targetId: "player-2",
      attackerUserId: "player-1",
      amount: 8,
      x: 100,
      y: 120,
    }
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [client],
    })
    Object.assign(room as object, {
      broadcast,
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            fireballLaunches: [fireballLaunch],
            fireballImpacts: [fireballImpact],
            homingOrbLaunches: [homingOrbLaunch],
            homingOrbImpacts: [homingOrbImpact],
            lightningBolts: [lightningBolt],
            primaryMeleeAttacks: [primaryMeleeAttack],
            combatTelegraphStarts: [combatTelegraphStart],
            combatTelegraphEnds: [combatTelegraphEnd],
            abilitySfxEvents: [abilitySfx],
            playerDeaths: [playerDeath],
            playerRespawns: [playerRespawn],
            damageFloats: [damageFloat],
            goldUpdates: [{ userId: "player-1", gold: 42 }],
          }),
        ),
        entityPlayerMap: new Map(),
      },
    })

    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.FireballLaunch, fireballLaunch)
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.FireballImpact, fireballImpact)
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.HomingOrbLaunch, homingOrbLaunch)
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.HomingOrbImpact, homingOrbImpact)
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.LightningBolt, lightningBolt)
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.PrimaryMeleeAttack, primaryMeleeAttack)
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.CombatTelegraphStart, combatTelegraphStart)
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.CombatTelegraphEnd, combatTelegraphEnd)
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.AbilitySfx, abilitySfx)
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.PlayerDeath, playerDeath)
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.PlayerRespawn, playerRespawn)
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.DamageFloat, damageFloat)
    expect(client.send).toHaveBeenCalledWith(RoomEvent.GoldBalance, { gold: 42 })
    expect(
      (room as unknown as { performanceImmediateBroadcastDurationMs: number })
        .performanceImmediateBroadcastDurationMs,
    ).toBeGreaterThanOrEqual(0)
  })

  it("sends critical semantic player deltas before budgeted visual deltas", () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, {
      broadcast,
      lobbyPhase: "IN_PROGRESS",
      lastNetworkFlushAtMs: 1_000,
      performanceConfig: resolveGamePerformanceConfig({
        WW_NET_SEND_BUDGET_ENABLED: "true",
        WW_NET_SEND_BUDGET_MAX_PLAYER_DELTAS: "1",
      }),
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            playerDeltas: [
              {
                id: 1,
                x: 10,
                y: 20,
                health: 80,
                terrainState: "lava",
              },
            ],
          }),
        ),
        entityPlayerMap: new Map(),
      },
    })

    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    const playerBatches = broadcast.mock.calls.filter(
      ([event]) => event === RoomEvent.PlayerBatchUpdate,
    )
    expect(playerBatches).toEqual([
      [
        RoomEvent.PlayerBatchUpdate,
        {
          deltas: [{ id: 1, health: 80, terrainState: "lava" }],
          removedIds: [],
          seq: 0,
          serverTimeMs: 2_000,
        },
      ],
      [
        RoomEvent.PlayerBatchUpdate,
        {
          deltas: [{ id: 1, x: 10, y: 20 }],
          removedIds: [],
          seq: 1,
          serverTimeMs: 2_000,
        },
      ],
    ])
  })

  it("merges sparse pending visuals into promoted mouse-aim cast samples", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, {
      broadcast,
      performanceConfig: resolveGamePerformanceConfig({
        WW_NET_SEND_BUDGET_ENABLED: "true",
      }),
    })
    ;(
      room as unknown as {
        playerVisualBatchCoalescer: PlayerVisualBatchCoalescer
      }
    ).playerVisualBatchCoalescer.ingest([{ id: 1, y: 6, moveFacingAngle: 0.4 }], 2_400)

    ;(
      room as unknown as {
        ingestPlayerDeltasForRoomWideBatches: (
          deltas: readonly {
            readonly id: number
            readonly x: number
            readonly vx: number
            readonly vy: number
            readonly facingAngle: number
            readonly animState: "light_cast"
            readonly castingAbilityId: "fireball"
          }[],
          serverTimeMs: number,
        ) => void
      }
    ).ingestPlayerDeltasForRoomWideBatches(
      [
        {
          id: 1,
          x: 10,
          vx: 1,
          vy: 2,
          facingAngle: 0.25,
          animState: "light_cast",
          castingAbilityId: "fireball",
        },
      ],
      2_500,
    )
    ;(room as unknown as { flushPendingVisualBatches: (serverTimeMs: number) => void })
      .flushPendingVisualBatches(2_520)

    expect(
      broadcast.mock.calls.filter(([event]) => event === RoomEvent.PlayerBatchUpdate),
    ).toEqual([
      [
        RoomEvent.PlayerBatchUpdate,
        {
          deltas: [
            {
              id: 1,
              x: 10,
              y: 6,
              vx: 1,
              vy: 2,
              facingAngle: 0.25,
              moveFacingAngle: 0.4,
              animState: "light_cast",
              castingAbilityId: "fireball",
            },
          ],
          removedIds: [],
          seq: 0,
          serverTimeMs: 2_500,
        },
      ],
    ])
  })

  it("keeps legacy visual flush ordering when send budget is disabled", () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_200)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    const damageFloat = {
      targetId: "player-2",
      attackerUserId: "player-1",
      amount: 8,
      x: 100,
      y: 120,
    }
    Object.assign(room as object, {
      broadcast,
      lobbyPhase: "IN_PROGRESS",
      lastNetworkFlushAtMs: 1_000,
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            playerDeltas: [{ id: 1, x: 10 }],
            damageFloats: [damageFloat],
          }),
        ),
        entityPlayerMap: new Map(),
      },
    })

    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    const visualBatchOrder = broadcast.mock.invocationCallOrder[
      broadcast.mock.calls.findIndex(([event]) => event === RoomEvent.PlayerBatchUpdate)
    ]!
    const damageFloatOrder = broadcast.mock.invocationCallOrder[
      broadcast.mock.calls.findIndex(([event]) => event === RoomEvent.DamageFloat)
    ]!
    expect(visualBatchOrder).toBeLessThan(damageFloatOrder)
  })

  it("sends immediate critical events before enabled-budget visual flushes", () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_500)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    const damageFloat = {
      targetId: "player-2",
      attackerUserId: "player-1",
      amount: 8,
      x: 100,
      y: 120,
    }
    Object.assign(room as object, {
      broadcast,
      lobbyPhase: "IN_PROGRESS",
      lastNetworkFlushAtMs: 2_000,
      performanceConfig: resolveGamePerformanceConfig({
        WW_NET_SEND_BUDGET_ENABLED: "true",
        WW_NET_SEND_BUDGET_MAX_PLAYER_DELTAS: "1",
      }),
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            playerDeltas: [{ id: 1, x: 10 }],
            damageFloats: [damageFloat],
          }),
        ),
        entityPlayerMap: new Map(),
      },
    })

    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    const damageFloatOrder = broadcast.mock.invocationCallOrder[
      broadcast.mock.calls.findIndex(([event]) => event === RoomEvent.DamageFloat)
    ]!
    const visualBatchOrder = broadcast.mock.invocationCallOrder[
      broadcast.mock.calls.findIndex(([event]) => event === RoomEvent.PlayerBatchUpdate)
    ]!
    expect(damageFloatOrder).toBeLessThan(visualBatchOrder)
  })

  it("defers player visuals over budget and force-flushes by max deferral age", () => {
    vi.useFakeTimers()
    vi.setSystemTime(3_000)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    const tick = vi
      .fn()
      .mockReturnValueOnce(
        simOutput({
          playerDeltas: [
            { id: 1, x: 10 },
            { id: 2, x: 20 },
            { id: 3, x: 30 },
          ],
        }),
      )
      .mockReturnValueOnce(simOutput())
    Object.assign(room as object, {
      broadcast,
      lobbyPhase: "IN_PROGRESS",
      lastNetworkFlushAtMs: 2_000,
      performanceConfig: resolveGamePerformanceConfig({
        WW_NET_SEND_BUDGET_ENABLED: "true",
        WW_NET_SEND_BUDGET_MAX_PLAYER_DELTAS: "1",
        WW_NET_SEND_BUDGET_MAX_DEFERRAL_MS: "250",
      }),
      simulation: {
        tick,
        entityPlayerMap: new Map(),
      },
    })

    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    expect(
      broadcast.mock.calls.filter(([event]) => event === RoomEvent.PlayerBatchUpdate),
    ).toEqual([
      [
        RoomEvent.PlayerBatchUpdate,
        {
          deltas: [{ id: 1, x: 10 }],
          removedIds: [],
          seq: 0,
          serverTimeMs: 3_000,
        },
      ],
    ])
    expect(
      (room as unknown as { performanceVisualBudgetDeferrals: number })
        .performanceVisualBudgetDeferrals,
    ).toBe(1)
    expect(
      (room as unknown as { performanceVisualBudgetDeferredEntities: number })
        .performanceVisualBudgetDeferredEntities,
    ).toBe(2)

    vi.setSystemTime(3_300)
    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    expect(
      broadcast.mock.calls.filter(([event]) => event === RoomEvent.PlayerBatchUpdate),
    ).toEqual([
      [
        RoomEvent.PlayerBatchUpdate,
        {
          deltas: [{ id: 1, x: 10 }],
          removedIds: [],
          seq: 0,
          serverTimeMs: 3_000,
        },
      ],
      [
        RoomEvent.PlayerBatchUpdate,
        {
          deltas: [
            { id: 2, x: 20 },
            { id: 3, x: 30 },
          ],
          removedIds: [],
          seq: 1,
          serverTimeMs: 3_300,
        },
      ],
    ])
    expect(
      (room as unknown as { performanceVisualBudgetMaxDeferralAgeMs: number })
        .performanceVisualBudgetMaxDeferralAgeMs,
    ).toBe(300)
  })

  it("applies the projectile visual budget to Fireball and Homing Orb room flushes", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, {
      broadcast,
      performanceConfig: resolveGamePerformanceConfig({
        WW_NET_SEND_BUDGET_ENABLED: "true",
        WW_NET_SEND_BUDGET_MAX_PROJECTILE_DELTAS: "1",
        WW_NET_SEND_BUDGET_MAX_REMOVALS: "1",
        WW_NET_SEND_BUDGET_MAX_DEFERRAL_MS: "250",
      }),
    })
    ;(
      room as unknown as {
        fireballVisualBatchCoalescer: FireballVisualBatchCoalescer
      }
    ).fireballVisualBatchCoalescer.ingest({
      deltas: [
        { id: 10, x: 100, y: 200 },
        { id: 11, x: 110, y: 210 },
      ],
      removedIds: [98, 99],
      serverTimeMs: 4_000,
    })
    ;(
      room as unknown as {
        homingOrbVisualBatchCoalescer: HomingOrbVisualBatchCoalescer
      }
    ).homingOrbVisualBatchCoalescer.ingest({
      deltas: [
        { id: 20, x: 300, y: 400, targetId: "player-1" },
        { id: 21, x: 310, y: 410, targetId: "player-2" },
      ],
      removedIds: [88, 89],
      serverTimeMs: 4_000,
    })

    ;(room as unknown as { flushPendingVisualBatches: (serverTimeMs: number) => void })
      .flushPendingVisualBatches(4_100)

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.FireballBatchUpdate, {
      deltas: [{ id: 10, x: 100, y: 200 }],
      removedIds: [98],
      seq: 0,
      serverTimeMs: 4_000,
    })
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.HomingOrbBatchUpdate, {
      deltas: [{ id: 20, x: 300, y: 400, targetId: "player-1" }],
      removedIds: [88],
      seq: 0,
      serverTimeMs: 4_000,
    })
    expect(
      (room as unknown as { performanceVisualBudgetDeferrals: number })
        .performanceVisualBudgetDeferrals,
    ).toBe(2)
    expect(
      (room as unknown as { performanceVisualBudgetDeferredEntities: number })
        .performanceVisualBudgetDeferredEntities,
    ).toBe(4)
    expect(
      (room as unknown as { performanceVisualBudgetMaxDeferralAgeMs: number })
        .performanceVisualBudgetMaxDeferralAgeMs,
    ).toBe(100)
  })

  it("force-flushes budgeted visuals before match-end cleanup", () => {
    vi.useFakeTimers()
    vi.setSystemTime(3_500)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, {
      broadcast,
      setMetadata: vi.fn(),
      lobbyPhase: "IN_PROGRESS",
      lastNetworkFlushAtMs: 3_000,
      performanceConfig: resolveGamePerformanceConfig({
        WW_NET_SEND_BUDGET_ENABLED: "true",
        WW_NET_SEND_BUDGET_MAX_PLAYER_DELTAS: "1",
        WW_NET_SEND_BUDGET_MAX_PROJECTILE_DELTAS: "1",
        WW_NET_SEND_BUDGET_MAX_REMOVALS: "1",
      }),
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            playerDeltas: [
              { id: 1, x: 10 },
              { id: 2, x: 20 },
            ],
            fireballDeltas: [
              { id: 10, x: 100, y: 200 },
              { id: 11, x: 110, y: 210 },
            ],
            matchEnded: {
              reason: "time_cap",
              entries: [],
            },
          }),
        ),
        entityPlayerMap: new Map(),
      },
    })

    ;(room as unknown as { runGameTick: () => boolean }).runGameTick()

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.PlayerBatchUpdate, {
      deltas: [
        { id: 1, x: 10 },
        { id: 2, x: 20 },
      ],
      removedIds: [],
      seq: 0,
      serverTimeMs: 3_500,
    })
    expect(broadcast).toHaveBeenCalledWith(RoomEvent.FireballBatchUpdate, {
      deltas: [
        { id: 10, x: 100, y: 200 },
        { id: 11, x: 110, y: 210 },
      ],
      removedIds: [],
      seq: 0,
      serverTimeMs: 3_500,
    })
    const playerBatchOrder = broadcast.mock.invocationCallOrder[
      broadcast.mock.calls.findIndex(([event]) => event === RoomEvent.PlayerBatchUpdate)
    ]!
    const scoreboardOrder = broadcast.mock.invocationCallOrder[
      broadcast.mock.calls.findIndex(([event]) => event === RoomEvent.LobbyScoreboard)
    ]!
    expect(playerBatchOrder).toBeLessThan(scoreboardOrder)
  })

  it("queues Homing Orb visual batches from tick output", () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, {
      broadcast,
      lobbyPhase: "IN_PROGRESS",
      lastNetworkFlushAtMs: 1_000,
      simulation: {
        tick: vi.fn().mockReturnValue(
          simOutput({
            homingOrbDeltas: [
              {
                id: 7,
                x: 10,
                y: 20,
              },
            ],
          }),
        ),
        entityPlayerMap: new Map(),
      },
    })

    ;(room as unknown as { runGameTick: () => void }).runGameTick()

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.HomingOrbBatchUpdate, {
      deltas: [
        {
          id: 7,
          x: 10,
          y: 20,
        },
      ],
      removedIds: [],
      seq: 0,
      serverTimeMs: 2_000,
    })
  })

  it("falls back to flush time when a pending Homing Orb batch lacks serverTimeMs", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, { broadcast })
    ;(
      room as unknown as {
        homingOrbVisualBatchCoalescer: HomingOrbVisualBatchCoalescer
      }
    ).homingOrbVisualBatchCoalescer.ingest({
      deltas: [{ id: 8, x: 1 }],
      removedIds: [],
    })

    ;(room as unknown as { flushPendingVisualBatches: (serverTimeMs: number) => void })
      .flushPendingVisualBatches(3_000)

    expect(broadcast).toHaveBeenCalledWith(RoomEvent.HomingOrbBatchUpdate, {
      deltas: [{ id: 8, x: 1 }],
      removedIds: [],
      seq: 0,
      serverTimeMs: 3_000,
    })
  })

  it("skips empty Homing Orb batches after ingest", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, { broadcast })
    ;(
      room as unknown as {
        homingOrbVisualBatchCoalescer: HomingOrbVisualBatchCoalescer
      }
    ).homingOrbVisualBatchCoalescer.ingest({
      deltas: [],
      removedIds: [],
      serverTimeMs: 3_100,
    })

    ;(room as unknown as { flushPendingVisualBatches: (serverTimeMs: number) => void })
      .flushPendingVisualBatches(3_100)

    expect(broadcast).not.toHaveBeenCalledWith(
      RoomEvent.HomingOrbBatchUpdate,
      expect.anything(),
    )
  })

  it("broadcasts server performance status only after the reporting window elapses", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [{ userData: { playerId: "player-1" } }],
    })
    Object.assign(room as object, {
      broadcast,
      performanceWindowStartedAtPerfMs: performance.now(),
      performanceWindowCpuStart: process.cpuUsage(),
      performanceDroppedDebtMs: 0,
      performanceCatchUpCallbacks: 0,
      performanceInputQueueDrops: 0,
      performanceSimDurationMs: 0,
      performanceBroadcastDurationMs: 0,
      performanceRoomTickDurationMs: 0,
      performanceVisualFlushDurationMs: 0,
      performanceOwnerAckSendDurationMs: 0,
      performanceImmediateBroadcastDurationMs: 0,
      performanceEventLoopLagMs: 0,
    })

    ;(
      room as unknown as {
        maybeBroadcastServerPerformanceStatus: (serverTimeMs: number) => void
      }
    ).maybeBroadcastServerPerformanceStatus(4_000)

    expect(broadcast).not.toHaveBeenCalled()

    Object.assign(room as object, {
      performanceWindowStartedAtPerfMs: performance.now() - 1_100,
      performanceWindowCpuStart: process.cpuUsage(),
      performanceDroppedDebtMs: 16,
      performanceCatchUpCallbacks: 2,
      performanceBroadcastDurationMs: 12,
      performanceRoomTickDurationMs: 9,
      performanceVisualFlushDurationMs: 2,
      performanceOwnerAckSendDurationMs: 1,
      performanceImmediateBroadcastDurationMs: 4,
      processEventLoopMonitor: {
        snapshot: vi.fn(() => ({
          processEventLoopDelayMs: 12,
          processEventLoopDelayP95Ms: 7,
          eventLoopUtilization: 0.6,
          gcPauseMs: 3,
        })),
      },
    })

    ;(
      room as unknown as {
        maybeBroadcastServerPerformanceStatus: (serverTimeMs: number) => void
      }
    ).maybeBroadcastServerPerformanceStatus(5_000)

    expect(broadcast).toHaveBeenCalledWith(
      RoomEvent.ServerPerformanceStatus,
      expect.objectContaining({
        serverTimeMs: 5_000,
        degraded: true,
        reasons: expect.arrayContaining(["dropped_debt", "catch_up"]),
        metrics: expect.objectContaining({
          droppedDebtMs: 16,
          catchUpCallbacks: 2,
          broadcastDurationMs: 7,
          roomTickDurationMs: 9,
          visualFlushDurationMs: 2,
          ownerAckSendDurationMs: 1,
          immediateBroadcastDurationMs: 4,
          processEventLoopDelayMs: 12,
          processEventLoopDelayP95Ms: 7,
          eventLoopUtilization: 0.6,
          gcPauseMs: 3,
          connectedClients: 1,
        }),
      }),
    )

    broadcast.mockClear()
    Object.assign(room as object, {
      performanceWindowStartedAtPerfMs: performance.now() - 1_100,
      performanceWindowCpuStart: process.cpuUsage(),
      performanceDroppedDebtMs: 1,
      performanceCatchUpCallbacks: 2,
      performanceBroadcastDurationMs: 4,
      performanceOwnerAckSendDurationMs: 6,
      performanceImmediateBroadcastDurationMs: 3,
      processEventLoopMonitor: {
        snapshot: vi.fn(() => ({})),
      },
    })

    ;(
      room as unknown as {
        maybeBroadcastServerPerformanceStatus: (serverTimeMs: number) => void
      }
    ).maybeBroadcastServerPerformanceStatus(5_500)

    expect(broadcast).toHaveBeenCalledWith(
      RoomEvent.ServerPerformanceStatus,
      expect.objectContaining({
        degraded: false,
        reasons: [],
        metrics: expect.objectContaining({
          broadcastDurationMs: 0,
          droppedDebtMs: 1,
        }),
      }),
    )
  })

  it("broadcasts one initial nominal server performance status for evidence", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [{ userData: { playerId: "player-1" } }],
    })
    Object.assign(room as object, {
      broadcast,
      performanceWindowStartedAtPerfMs: performance.now() - 1_100,
      performanceWindowCpuStart: process.cpuUsage(),
      performanceDroppedDebtMs: 0,
      performanceCatchUpCallbacks: 0,
      performanceInputQueueDrops: 0,
      performanceSimDurationMs: 1,
      performanceBroadcastDurationMs: 2,
      performanceRoomTickDurationMs: 3,
      performanceVisualFlushDurationMs: 4,
      performanceOwnerAckSendDurationMs: 5,
      performanceImmediateBroadcastDurationMs: 6,
      performanceVisualBudgetDeferrals: 0,
      performanceVisualBudgetDeferredEntities: 0,
      performanceVisualBudgetMaxDeferralAgeMs: 0,
      performanceVisualBudgetDroppedVisuals: 0,
      performanceCriticalSendFailures: 0,
      performanceEventLoopLagMs: 20,
      performanceEventLoopLagSamplesMs: [0, 0, 1, 2, 3],
      processEventLoopMonitor: {
        snapshot: vi.fn(() => ({})),
      },
    })

    ;(
      room as unknown as {
        maybeBroadcastServerPerformanceStatus: (serverTimeMs: number) => void
      }
    ).maybeBroadcastServerPerformanceStatus(6_000)

    expect(broadcast).toHaveBeenCalledWith(
      RoomEvent.ServerPerformanceStatus,
      expect.objectContaining({
        degraded: false,
        reasons: [],
        metrics: expect.objectContaining({
          eventLoopLagMs: 20,
          eventLoopLagP95Ms: 3,
        }),
      }),
    )

    broadcast.mockClear()
    Object.assign(room as object, {
      performanceWindowStartedAtPerfMs: performance.now() - 1_100,
      performanceWindowCpuStart: process.cpuUsage(),
      performanceEventLoopLagMs: 0,
      performanceEventLoopLagSamplesMs: [0],
    })
    ;(
      room as unknown as {
        maybeBroadcastServerPerformanceStatus: (serverTimeMs: number) => void
      }
    ).maybeBroadcastServerPerformanceStatus(7_000)

    expect(broadcast).not.toHaveBeenCalled()
  })

  it("records loop timing samples and reports p95 lag separately from max lag", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [{ userData: { playerId: "player-1" } }],
    })
    Object.assign(room as object, {
      broadcast,
      performanceWindowStartedAtPerfMs: performance.now() - 1_100,
      performanceWindowCpuStart: process.cpuUsage(),
      performanceDroppedDebtMs: 0,
      performanceCatchUpCallbacks: 0,
      performanceInputQueueDrops: 0,
      performanceSimDurationMs: 1,
      performanceBroadcastDurationMs: 2,
      performanceRoomTickDurationMs: 3,
      performanceVisualFlushDurationMs: 4,
      performanceOwnerAckSendDurationMs: 5,
      performanceImmediateBroadcastDurationMs: 6,
      performanceVisualBudgetDeferrals: 0,
      performanceVisualBudgetDeferredEntities: 0,
      performanceVisualBudgetMaxDeferralAgeMs: 0,
      performanceVisualBudgetDroppedVisuals: 0,
      performanceCriticalSendFailures: 0,
      processEventLoopMonitor: {
        snapshot: vi.fn(() => ({})),
      },
    })

    const privateRoom = room as unknown as {
      recordLoopTiming: (elapsedMs: number) => void
      maybeBroadcastServerPerformanceStatus: (serverTimeMs: number) => void
    }
    for (let index = 0; index < 19; index += 1) {
      privateRoom.recordLoopTiming(TICK_MS)
    }
    privateRoom.recordLoopTiming(TICK_MS + 20)
    privateRoom.maybeBroadcastServerPerformanceStatus(6_000)

    const payload = broadcast.mock.calls[0]?.[1]
    expect(broadcast.mock.calls[0]?.[0]).toBe(RoomEvent.ServerPerformanceStatus)
    expect(payload).toMatchObject({
      degraded: false,
      reasons: [],
      metrics: {
        eventLoopLagP95Ms: 0,
      },
    })
    expect(payload.metrics.eventLoopLagMs).toBeCloseTo(20)
  })

  it("broadcasts nominal server performance status when visual budget telemetry is present", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [{ userData: { playerId: "player-1" } }],
    })
    Object.assign(room as object, {
      broadcast,
      performanceWindowStartedAtPerfMs: performance.now() - 1_100,
      performanceWindowCpuStart: process.cpuUsage(),
      performanceDroppedDebtMs: 0,
      performanceCatchUpCallbacks: 0,
      performanceInputQueueDrops: 0,
      performanceSimDurationMs: 1,
      performanceBroadcastDurationMs: 2,
      performanceRoomTickDurationMs: 3,
      performanceVisualFlushDurationMs: 4,
      performanceOwnerAckSendDurationMs: 5,
      performanceImmediateBroadcastDurationMs: 6,
      performanceVisualBudgetDeferrals: 1,
      performanceVisualBudgetDeferredEntities: 2,
      performanceVisualBudgetMaxDeferralAgeMs: 125,
      performanceVisualBudgetDroppedVisuals: 0,
      performanceCriticalSendFailures: 0,
      performanceEventLoopLagMs: 0,
      processEventLoopMonitor: {
        snapshot: vi.fn(() => ({})),
      },
    })

    ;(
      room as unknown as {
        maybeBroadcastServerPerformanceStatus: (serverTimeMs: number) => void
      }
    ).maybeBroadcastServerPerformanceStatus(6_000)

    expect(broadcast).toHaveBeenCalledWith(
      RoomEvent.ServerPerformanceStatus,
      expect.objectContaining({
        degraded: false,
        reasons: [],
        metrics: expect.objectContaining({
          visualBudgetDeferrals: 1,
          visualBudgetDeferredEntities: 2,
          visualBudgetMaxDeferralAgeMs: 125,
          visualBudgetDroppedVisuals: 0,
          criticalSendFailures: 0,
        }),
      }),
    )
  })

  it("logs nominal server performance windows by cadence and degraded windows immediately", () => {
    const logSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined)
    const room = new GameLobbyRoom()
    const perfMetrics = {
      windowMs: 1_000,
      droppedDebtMs: 0,
      catchUpCallbacks: 0,
      inputQueueDrops: 0,
      simDurationMs: 1,
      broadcastDurationMs: 2,
      roomTickDurationMs: 3,
      visualFlushDurationMs: 4,
      ownerAckSendDurationMs: 5,
      immediateBroadcastDurationMs: 6,
      eventLoopLagMs: 0,
      processCpuPercent: 1,
      heapUsedBytes: 2,
      rssBytes: 3,
      activeRooms: 1,
      connectedClients: 1,
    }
    Object.assign(room as object, {
      lobbyPhase: "IN_PROGRESS",
      roomId: "room-test",
      lastServerPerfLogAtMs: 1_000,
      performanceConfig: {
        serverPerfLogsEnabled: true,
        serverPerfLogIntervalMs: 1_000,
        perfRunId: "local_compact_8",
      },
    })

    ;(
      room as unknown as {
        maybeLogServerPerformanceWindow: (
          serverTimeMs: number,
          classification: { degraded: boolean; reasons: readonly string[] },
          metrics: typeof perfMetrics,
          processMetricUnavailableReason?: string,
        ) => void
      }
    ).maybeLogServerPerformanceWindow(
      1_500,
      { degraded: false, reasons: [] },
      perfMetrics,
    )
    expect(logSpy).not.toHaveBeenCalled()

    ;(
      room as unknown as {
        maybeLogServerPerformanceWindow: (
          serverTimeMs: number,
          classification: { degraded: boolean; reasons: readonly string[] },
          metrics: typeof perfMetrics,
          processMetricUnavailableReason?: string,
        ) => void
      }
    ).maybeLogServerPerformanceWindow(
      1_500,
      { degraded: true, reasons: ["event_loop_lag"] },
      perfMetrics,
      "monitorEventLoopDelay unavailable",
    )

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "room.performance.window",
        roomId: "room-test",
        runId: "local_compact_8",
        degraded: true,
        reasons: ["event_loop_lag"],
        metrics: perfMetrics,
        processMetricUnavailableReason: "monitorEventLoopDelay unavailable",
      }),
      "Room performance window",
    )

    logSpy.mockClear()
    Object.assign(room as object, {
      lastServerPerfLogAtMs: 2_000,
      performanceConfig: {
        serverPerfLogsEnabled: true,
        serverPerfLogIntervalMs: 1_000,
        perfRunId: null,
      },
    })
    ;(
      room as unknown as {
        maybeLogServerPerformanceWindow: (
          serverTimeMs: number,
          classification: { degraded: boolean; reasons: readonly string[] },
          metrics: typeof perfMetrics,
        ) => void
      }
    ).maybeLogServerPerformanceWindow(
      3_000,
      { degraded: false, reasons: [] },
      perfMetrics,
    )

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "room.performance.window",
        runId: undefined,
      }),
      "Room performance window",
    )
  })
})
