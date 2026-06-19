import { afterEach, describe, expect, it, vi } from "vitest"

import { CLOSE_CODE_ADMIN_CLOSED } from "@/shared/constants"
import { RoomEvent } from "@/shared/roomEvents"
import { TICK_MS } from "@/shared/balance-config/rendering"
import type { PlayerInputPayload } from "@/shared/types"
import type { SimOutput } from "@/server/game/simulation"

import { GameLobbyRoom } from "./GameLobbyRoom"

type LoopRoomInternals = {
  broadcast: ReturnType<typeof vi.fn>
  inputQueue: Map<string, PlayerInputPayload[]>
  gameLoopTimer: { clear: () => void } | null
  adminCloseTimer: { clear: () => void } | null
  disposalGraceTimer: { clear: () => void } | null
  lobbyPhase: string
  performanceCatchUpCallbacks: number
  performanceDroppedDebtMs: number
  performanceConfig: {
    netSendIntervalMs: number
    simAccumulatorEnabled: boolean
    simMaxCatchUpTicks: number
  }
  clearGameLoopTimer: () => void
  resetSimulationLoopState: (serverTimeMs: number) => void
  runGameLoop: (elapsedMs: number) => void
  runGameTick: (serverTimeMs?: number) => boolean
  setSimulationInterval: (callback?: (deltaMs: number) => void, delay?: number) => void
  simulation: {
    tick: (inputQueue: Map<string, PlayerInputPayload[]>, serverTimeMs: number) => SimOutput
    entityPlayerMap: Map<number, string>
  } | null
}

describe("GameLobbyRoom fixed-step loop", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("catches up a 100ms stall with six fixed simulation ticks and monotonic simulated time", () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_100)

    const room = loopRoom()
    const times: number[] = []
    const tick = vi.fn((_queue: Map<string, PlayerInputPayload[]>, serverTimeMs: number) => {
      times.push(serverTimeMs)
      return simOutput()
    })
    Object.assign(room, {
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        tick,
        entityPlayerMap: new Map(),
      },
    })

    room.resetSimulationLoopState(10_000)
    room.runGameLoop(100)

    expect(tick).toHaveBeenCalledTimes(6)
    expect(times[0]).toBeCloseTo(10_000 + TICK_MS, 6)
    expect(times.at(-1)).toBeCloseTo(10_100, 6)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(Math.max(...times)).toBeLessThanOrEqual(Date.now())
    expect(room.performanceDroppedDebtMs).toBe(0)
    expect(room.performanceCatchUpCallbacks).toBe(5)
  })

  it("carries fractional elapsed time between callbacks before ticking", () => {
    vi.useFakeTimers()
    vi.setSystemTime(20_000)

    const room = loopRoom()
    const tick = vi.fn(() => simOutput())
    Object.assign(room, {
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        tick,
        entityPlayerMap: new Map(),
      },
    })

    room.resetSimulationLoopState(20_000)
    room.runGameLoop(TICK_MS - 0.1)
    expect(tick).not.toHaveBeenCalled()

    room.runGameLoop(0.2)
    expect(tick).toHaveBeenCalledOnce()
  })

  it("keeps queued input ordering by running one authoritative tick per fixed step", () => {
    vi.useFakeTimers()
    vi.setSystemTime(30_100)

    const room = loopRoom()
    const consumedSeqs: number[] = []
    room.inputQueue.set(
      "player-1",
      Array.from({ length: 6 }, (_, seq) => input(seq)),
    )
    Object.assign(room, {
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        tick: vi.fn((queue: Map<string, PlayerInputPayload[]>) => {
          const next = queue.get("player-1")?.shift()
          if (next) consumedSeqs.push(next.seq)
          return simOutput()
        }),
        entityPlayerMap: new Map(),
      },
    })

    room.resetSimulationLoopState(30_000)
    room.runGameLoop(100)

    expect(consumedSeqs).toEqual([0, 1, 2, 3, 4, 5])
  })

  it("caps extreme catch-up work and records only discarded debt as dropped", () => {
    vi.useFakeTimers()
    vi.setSystemTime(40_000)

    const room = loopRoom({ simMaxCatchUpTicks: 3 })
    const tick = vi.fn(() => simOutput())
    Object.assign(room, {
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        tick,
        entityPlayerMap: new Map(),
      },
    })

    room.resetSimulationLoopState(40_000)
    room.runGameLoop(TICK_MS * 10)

    expect(tick).toHaveBeenCalledTimes(3)
    expect(room.performanceDroppedDebtMs).toBeCloseTo(TICK_MS * 7, 6)
    expect(room.performanceCatchUpCallbacks).toBe(2)
  })

  it("stops catch-up immediately when a tick ends the match", () => {
    vi.useFakeTimers()
    vi.setSystemTime(50_100)

    const room = loopRoom()
    const transitionToScoreboard = vi.fn(() => {
      Object.assign(room, {
        lobbyPhase: "SCOREBOARD",
        simulation: null,
        gameLoopTimer: null,
      })
    })
    const tick = vi
      .fn()
      .mockReturnValueOnce(simOutput())
      .mockReturnValueOnce(
        simOutput({
          matchEnded: {
            reason: "lives_depleted",
            entries: [],
          },
        }),
      )
    Object.assign(room, {
      lobbyPhase: "IN_PROGRESS",
      transitionToScoreboard,
      simulation: {
        tick,
        entityPlayerMap: new Map(),
      },
    })

    room.resetSimulationLoopState(50_000)
    room.runGameLoop(100)

    expect(tick).toHaveBeenCalledTimes(2)
    expect(transitionToScoreboard).toHaveBeenCalledOnce()
  })

  it("does not tick without an active in-progress simulation", () => {
    const room = loopRoom()

    expect(() => room.runGameLoop(100)).not.toThrow()
    expect(room.runGameTick()).toBe(false)
  })

  it("ignores invalid elapsed time without counting dropped debt", () => {
    const room = loopRoom()
    const tick = vi.fn(() => simOutput())
    Object.assign(room, {
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        tick,
        entityPlayerMap: new Map(),
      },
    })

    room.resetSimulationLoopState(55_000)
    room.runGameLoop(Number.NaN)

    expect(tick).not.toHaveBeenCalled()
    expect(room.performanceDroppedDebtMs).toBe(0)
  })

  it("runs one legacy tick per callback when the accumulator is disabled", () => {
    vi.useFakeTimers()
    vi.setSystemTime(56_000)

    const room = loopRoom({ simAccumulatorEnabled: false })
    const times: number[] = []
    const tick = vi.fn((_queue: Map<string, PlayerInputPayload[]>, serverTimeMs: number) => {
      times.push(serverTimeMs)
      return simOutput()
    })
    Object.assign(room, {
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        tick,
        entityPlayerMap: new Map(),
      },
    })

    room.resetSimulationLoopState(55_000)
    room.runGameLoop(100)

    expect(tick).toHaveBeenCalledOnce()
    expect(times).toEqual([56_000])
    expect(room.performanceDroppedDebtMs).toBe(0)
  })

  it("clears the simulation loop during dispose, scoreboard, and admin-close cleanup", () => {
    vi.useFakeTimers()

    const disposed = new GameLobbyRoom() as unknown as LoopRoomInternals & { onDispose: () => void }
    const disposeClear = vi.fn()
    const adminCloseClear = vi.fn()
    Object.assign(disposed, {
      adminCloseTimer: { clear: adminCloseClear },
      gameLoopTimer: { clear: disposeClear },
    })
    disposed.onDispose()
    expect(disposeClear).toHaveBeenCalledOnce()
    expect(adminCloseClear).toHaveBeenCalledOnce()

    const scoreboard = new GameLobbyRoom() as unknown as LoopRoomInternals & {
      transitionToScoreboard: (reason: "host_ended", entries: []) => void
      updateMetadataPhase: () => void
    }
    const scoreboardClear = vi.fn()
    Object.assign(scoreboard, {
      broadcast: vi.fn(),
      gameLoopTimer: { clear: scoreboardClear },
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        tick: vi.fn(() => simOutput()),
        entityPlayerMap: new Map(),
      },
      updateMetadataPhase: vi.fn(),
    })
    scoreboard.transitionToScoreboard("host_ended", [])
    expect(scoreboardClear).toHaveBeenCalledOnce()
    expect(scoreboard.gameLoopTimer).toBeNull()

    const admin = new GameLobbyRoom() as unknown as LoopRoomInternals & {
      stopForAdminClose: () => void
    }
    const adminClear = vi.fn()
    const disposalGraceClear = vi.fn()
    Object.assign(admin, {
      disposalGraceTimer: { clear: disposalGraceClear },
      gameLoopTimer: { clear: adminClear },
    })
    admin.stopForAdminClose()
    expect(disposalGraceClear).toHaveBeenCalledOnce()
    expect(adminClear).toHaveBeenCalledOnce()
    expect(admin.gameLoopTimer).toBeNull()
  })

  it("starts the match loop through Colyseus setSimulationInterval", () => {
    vi.useFakeTimers()
    vi.setSystemTime(60_000)

    const rawRoom = new GameLobbyRoom()
    const setSimulationInterval = vi.fn()
    const runGameLoop = vi
      .spyOn(rawRoom as unknown as { runGameLoop: (deltaMs: number) => void }, "runGameLoop")
      .mockImplementation(() => {})
    let callback: ((deltaMs: number) => void) | undefined
    const client = {
      userData: {
        playerId: "player-1",
        username: "PlayerOne",
        heroId: "red_wizard",
      },
      send: vi.fn(),
    }
    Object.defineProperty(rawRoom, "clients", {
      configurable: true,
      value: [client],
    })
    Object.assign(rawRoom as object, {
      broadcast: vi.fn(),
      setSimulationInterval: vi.fn((nextCallback?: (deltaMs: number) => void, delay?: number) => {
        callback = nextCallback
        setSimulationInterval(nextCallback, delay)
      }),
      updateMetadataPhase: vi.fn(),
    })

    ;(rawRoom as unknown as { startGame: () => void }).startGame()

    expect(setSimulationInterval).toHaveBeenCalledWith(expect.any(Function), TICK_MS)
    callback?.(TICK_MS)
    expect(runGameLoop).toHaveBeenCalledWith(TICK_MS)
    ;(rawRoom as unknown as { gameLoopTimer: { clear: () => void } | null }).gameLoopTimer?.clear()
  })

  it("begins countdown with a synced MatchCountdownStart payload", () => {
    vi.useFakeTimers()
    vi.setSystemTime(70_000)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    Object.assign(room as object, {
      broadcast,
      updateMetadataPhase: vi.fn(),
    })

    ;(room as unknown as { beginCountdown: () => void }).beginCountdown()

    expect((room as unknown as { lobbyPhase: string }).lobbyPhase).toBe("COUNTDOWN")
    expect(broadcast).toHaveBeenCalledWith(
      RoomEvent.MatchCountdownStart,
      expect.objectContaining({ startAtServerTimeMs: 70_000 }),
    )
    ;(room as unknown as { countdownTimer: { clear: () => void } | null })
      .countdownTimer?.clear()
  })

  it("admin close locks and immediately disconnects an empty lobby", async () => {
    const room = new GameLobbyRoom()
    const lock = vi.fn().mockResolvedValue(undefined)
    const disconnect = vi.fn()
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [],
    })
    Object.assign(room as object, {
      lock,
      disconnect,
      stopForAdminClose: vi.fn(),
    })

    const result = await room.adminCloseLobby({
      adminUserId: "admin-1",
      adminUsername: "Admin",
      confirmed: false,
    })

    expect(lock).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledWith(CLOSE_CODE_ADMIN_CLOSED)
    expect(result).toEqual({
      status: "closed",
      occupied: false,
      closeAtServerMs: null,
    })
  })

  it("admin close broadcasts a countdown for occupied lobbies", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(80_000)

    const room = new GameLobbyRoom()
    const broadcast = vi.fn()
    const disconnect = vi.fn()
    const oldAdminCloseClear = vi.fn()
    Object.defineProperty(room, "clients", {
      configurable: true,
      value: [{ userData: { playerId: "player-1" } }],
    })
    Object.assign(room as object, {
      adminCloseTimer: { clear: oldAdminCloseClear },
      broadcast,
      disconnect,
      lock: vi.fn().mockResolvedValue(undefined),
      stopForAdminClose: vi.fn(),
    })

    const result = await room.adminCloseLobby({
      adminUserId: "admin-1",
      adminUsername: "Admin",
      confirmed: true,
    })

    expect(broadcast).toHaveBeenCalledWith(
      RoomEvent.LobbyAdminClosing,
      expect.objectContaining({
        reason: "admin_closed",
        closeAtServerMs: 110_000,
        countdownMs: 30_000,
      }),
    )
    expect(result).toEqual({
      status: "closing",
      occupied: true,
      closeAtServerMs: 110_000,
      countdownMs: 30_000,
    })
    expect(oldAdminCloseClear).toHaveBeenCalledOnce()
    expect(disconnect).not.toHaveBeenCalled()

    vi.advanceTimersByTime(30_000)

    expect(disconnect).toHaveBeenCalledWith(CLOSE_CODE_ADMIN_CLOSED)
    expect(
      (room as unknown as { adminCloseTimer: { clear: () => void } | null })
        .adminCloseTimer,
    ).toBeNull()
  })
})

function loopRoom(
  config: Partial<LoopRoomInternals["performanceConfig"]> = {},
): LoopRoomInternals {
  const room = new GameLobbyRoom() as unknown as LoopRoomInternals
  Object.assign(room, {
    broadcast: vi.fn(),
    lastNetworkFlushAtMs: 0,
    performanceCatchUpCallbacks: 0,
    performanceDroppedDebtMs: 0,
    performanceConfig: {
      netSendIntervalMs: 1000 / 30,
      simAccumulatorEnabled: true,
      simMaxCatchUpTicks: 6,
      ...config,
    },
  })
  return room
}

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

function input(seq: number): PlayerInputPayload {
  return {
    up: false,
    down: false,
    left: false,
    right: true,
    abilitySlot: null,
    abilityTargetX: 0,
    abilityTargetY: 0,
    weaponPrimary: false,
    weaponSecondary: false,
    weaponTargetX: 0,
    weaponTargetY: 0,
    useQuickItemSlot: null,
    seq,
    clientSendTimeMs: 1_000 + seq,
  }
}
