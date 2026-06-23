import { afterEach, describe, expect, it, vi } from "vitest"

import { RoomEvent } from "@/shared/roomEvents"
import { createGameSimulation, type SimOutput } from "@/server/game/simulation"
import { createSessionEconomy } from "@/server/gameserver/sessionShop"
import { hasComponent } from "bitecs"
import {
  NeedsWorldCollisionResolution,
  Position,
  Velocity,
} from "@/server/game/components"

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
  const originalE2e = process.env.WIZARD_WARS_E2E
  const originalInputProtocol = process.env.WW_INPUT_PROTOCOL

  afterEach(() => {
    vi.useRealTimers()
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
        protocolVersion: 1,
        preferredTransport: "compact",
        activeHeartbeatMs: 100,
        idleHeartbeatMs: 1_000,
      },
    })
    expect(sync).toMatchObject({ timing: matchGo.timing })
    expect(sync).toMatchObject({ input: matchGo.input })

    ;(room as unknown as { gameLoopTimer: { clear: () => void } | null }).gameLoopTimer?.clear()
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
        protocolVersion: 1,
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

  it("falls back to flush time when legacy Fireball pending batches lack serverTimeMs", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, {
      broadcast,
      pendingFireballBatches: [{ deltas: [{ id: 43, x: 1, y: 2 }], removedIds: [] }],
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

  it("falls back to flush time when legacy Homing Orb pending batches lack serverTimeMs", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, {
      broadcast,
      pendingHomingOrbBatches: [{ deltas: [{ id: 8, x: 1 }], removedIds: [] }],
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

  it("skips empty Homing Orb pending batches after merge", () => {
    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, {
      broadcast,
      pendingHomingOrbBatches: [{ deltas: [], removedIds: [], serverTimeMs: 3_100 }],
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
      performanceDroppedDebtMs: 1,
      performanceCatchUpCallbacks: 2,
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
          droppedDebtMs: 1,
          catchUpCallbacks: 2,
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
    })

    ;(
      room as unknown as {
        maybeBroadcastServerPerformanceStatus: (serverTimeMs: number) => void
      }
    ).maybeBroadcastServerPerformanceStatus(5_500)

    expect(broadcast).not.toHaveBeenCalled()
  })
})
