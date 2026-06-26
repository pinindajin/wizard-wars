import { describe, expect, it, vi } from "vitest"

import { RoomEvent } from "@/shared/roomEvents"
import type { PlayerInputPayload, PlayerInputStatePayload } from "@/shared/types"
import type { PlayerInputQueueMap } from "@/server/game/playerInputQueue"

import { GameLobbyRoom } from "./GameLobbyRoom"

type InputRoomInternals = {
  isAdminClosing: boolean
  lobbyPhase: string
  simulation: object | null
  inputQueue: PlayerInputQueueMap
  performanceInputQueueDrops: number
  onMessage: ReturnType<typeof vi.fn>
  registerLobbyHandlers: () => void
  handlePlayerInput: (client: TestClient, payload: unknown) => void
  handlePlayerInputState: (client: TestClient, payload: unknown) => void
}

type TestClient = {
  readonly sessionId: string
  readonly userData: {
    readonly playerId: string
  }
  readonly send: ReturnType<typeof vi.fn>
}

function client(playerId = "player-1"): TestClient {
  return {
    sessionId: `${playerId}-session`,
    userData: { playerId },
    send: vi.fn(),
  }
}

function input(overrides: Partial<PlayerInputPayload> = {}): PlayerInputPayload {
  return {
    up: false,
    down: false,
    left: false,
    right: true,
    abilitySlot: null,
    abilityTargetX: 10,
    abilityTargetY: 20,
    weaponPrimary: false,
    weaponSecondary: false,
    weaponTargetX: 10,
    weaponTargetY: 20,
    useQuickItemSlot: null,
    seq: 1,
    clientSendTimeMs: 1_000,
    ...overrides,
  }
}

function compact(overrides: Partial<PlayerInputStatePayload> = {}): PlayerInputStatePayload {
  return {
    protocolVersion: 1,
    seq: 1,
    clientSendTimeMs: 1_000,
    buttons: 8,
    targetX: 10,
    targetY: 20,
    ...overrides,
  }
}

function room(): InputRoomInternals {
  const raw = new GameLobbyRoom() as unknown as InputRoomInternals
  Object.assign(raw, {
    lobbyPhase: "IN_PROGRESS",
    simulation: {},
  })
  return raw
}

describe("GameLobbyRoom compact player input state", () => {
  it("registers compact input state without handling messages during admin close", () => {
    const r = room()
    const c = client()
    const handlers = new Map<string, (client: TestClient, payload: unknown) => void>()
    const handlePlayerInputState = vi.fn()
    Object.assign(r, {
      handlePlayerInputState,
      isAdminClosing: false,
      onMessage: vi.fn((event: string, handler: (client: TestClient, payload: unknown) => void) => {
        handlers.set(event, handler)
      }),
    })

    r.registerLobbyHandlers()

    handlers.get(RoomEvent.PlayerInputState)?.(c, compact())
    r.isAdminClosing = true
    handlers.get(RoomEvent.PlayerInputState)?.(c, compact({ seq: 2 }))

    expect(handlePlayerInputState).toHaveBeenCalledOnce()
    expect(handlePlayerInputState).toHaveBeenCalledWith(c, compact())
  })

  it("keeps legacy full player_input accepted during rollout", () => {
    const r = room()
    const c = client()
    const legacy = input({ seq: 3, weaponPrimary: true })

    r.handlePlayerInput(c, legacy)

    expect(r.inputQueue.get("player-1")?.toArray()).toEqual([legacy])
  })

  it("decodes player_input_state into the canonical full input queue", () => {
    const r = room()
    const c = client()

    r.handlePlayerInputState(
      c,
      compact({
        buttons: 1 | 8 | 16,
        abilitySlot: 2,
        useQuickItemSlot: 1,
        targetX: 300,
        targetY: 400,
      }),
    )

    expect(r.inputQueue.get("player-1")?.toArray()).toEqual([
      {
        up: true,
        down: false,
        left: false,
        right: true,
        abilitySlot: 2,
        abilityTargetX: 300,
        abilityTargetY: 400,
        weaponPrimary: true,
        weaponSecondary: false,
        weaponTargetX: 300,
        weaponTargetY: 400,
        useQuickItemSlot: 1,
        seq: 1,
        clientSendTimeMs: 1_000,
      },
    ])
  })

  it("uses the same stale-seq duplicate filter for compact and legacy inputs", () => {
    const r = room()
    const c = client()

    r.handlePlayerInputState(c, compact({ seq: 5 }))
    r.handlePlayerInput(c, input({ seq: 5 }))
    r.handlePlayerInputState(c, compact({ seq: 6, buttons: 0 }))

    expect(r.inputQueue.get("player-1")?.toArray().map((queued) => queued.seq))
      .toEqual([5, 6])
  })

  it("rejects legacy and compact input outside active simulation", () => {
    const r = room()
    const c = client()
    Object.assign(r, { lobbyPhase: "LOBBY", simulation: null })

    r.handlePlayerInput(c, input())
    r.handlePlayerInputState(c, compact())

    expect(r.inputQueue.get("player-1")).toBeUndefined()
  })

  it("rejects malformed legacy and compact input payloads", () => {
    const r = room()
    const c = client()

    r.handlePlayerInput(c, { ...input(), seq: -1 })
    r.handlePlayerInputState(c, { ...compact(), buttons: 64 })

    expect(r.inputQueue.get("player-1")).toBeUndefined()
  })

  it("caps compact input queues with the same drop accounting as legacy input", () => {
    const r = room()
    const c = client()

    for (let seq = 0; seq < 40; seq++) {
      r.handlePlayerInputState(c, compact({ seq }))
    }

    const queuedSeqs = r.inputQueue
      .get("player-1")
      ?.toArray()
      .map((queued) => queued.seq)
    expect(queuedSeqs).toHaveLength(32)
    expect(queuedSeqs?.[0]).toBe(8)
    expect(queuedSeqs?.at(-1)).toBe(39)
    expect(r.performanceInputQueueDrops).toBe(8)
  })
})
