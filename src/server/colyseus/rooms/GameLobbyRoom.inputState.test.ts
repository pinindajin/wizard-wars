import { describe, expect, it, vi } from "vitest"

import { RoomEvent } from "@/shared/roomEvents"
import type {
  PlayerInputCommandRunPayload,
  PlayerInputPayload,
} from "@/shared/types"
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

function compact(overrides: Partial<PlayerInputCommandRunPayload> = {}) {
  const fromSeq = overrides.fromSeq ?? 1
  return {
    protocolVersion: 2,
    runs: [
      {
        fromSeq,
        toSeq: overrides.toSeq ?? fromSeq,
        clientSendTimeMs: 1_000,
        buttons: 8,
        targetX: 10,
        targetY: 20,
        ...overrides,
      },
    ],
  }
}

function commandRun(
  overrides: Partial<PlayerInputCommandRunPayload> = {},
): PlayerInputCommandRunPayload {
  return {
    fromSeq: 10,
    toSeq: 12,
    clientSendTimeMs: 1_500,
    buttons: 8,
    targetX: 300,
    targetY: 400,
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
    handlers.get(RoomEvent.PlayerInputState)?.(c, compact({ fromSeq: 2 }))

    expect(handlePlayerInputState).toHaveBeenCalledOnce()
    expect(handlePlayerInputState).toHaveBeenCalledWith(c, compact())
  })

  it("keeps full player_input accepted for explicit legacy transport mode", () => {
    const r = room()
    const c = client()
    const legacy = input({ seq: 3, weaponPrimary: true })

    r.handlePlayerInput(c, legacy)

    expect(r.inputQueue.get("player-1")?.toArray()).toEqual([legacy])
  })

  it("rejects protocol v1 player_input_state payloads", () => {
    const r = room()
    const c = client()

    r.handlePlayerInputState(c, {
      protocolVersion: 1,
      seq: 1,
      clientSendTimeMs: 1_000,
      buttons: 8,
      targetX: 10,
      targetY: 20,
    })

    expect(r.inputQueue.get("player-1")).toBeUndefined()
  })

  it("decodes player_input_state v2 batches into the canonical full input queue", () => {
    const r = room()
    const c = client()

    r.handlePlayerInputState(
      c,
      compact({
        fromSeq: 1,
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

  it("enqueues v2 command runs as one command per covered sequence", () => {
    const r = room()
    const c = client()

    r.handlePlayerInputState(c, {
      protocolVersion: 2,
      runs: [commandRun()],
    })

    expect(r.inputQueue.get("player-1")?.toArray()).toEqual([
      {
        up: false,
        down: false,
        left: false,
        right: true,
        abilitySlot: null,
        abilityTargetX: 300,
        abilityTargetY: 400,
        weaponPrimary: false,
        weaponSecondary: false,
        weaponTargetX: 300,
        weaponTargetY: 400,
        useQuickItemSlot: null,
        seq: 10,
        clientSendTimeMs: 1_500,
      },
      {
        up: false,
        down: false,
        left: false,
        right: true,
        abilitySlot: null,
        abilityTargetX: 300,
        abilityTargetY: 400,
        weaponPrimary: false,
        weaponSecondary: false,
        weaponTargetX: 300,
        weaponTargetY: 400,
        useQuickItemSlot: null,
        seq: 11,
        clientSendTimeMs: 1_500,
      },
      {
        up: false,
        down: false,
        left: false,
        right: true,
        abilitySlot: null,
        abilityTargetX: 300,
        abilityTargetY: 400,
        weaponPrimary: false,
        weaponSecondary: false,
        weaponTargetX: 300,
        weaponTargetY: 400,
        useQuickItemSlot: null,
        seq: 12,
        clientSendTimeMs: 1_500,
      },
    ])
  })

  it("trims overlapping v2 command runs through the highest accepted sequence", () => {
    const r = room()
    const c = client()

    r.handlePlayerInputState(c, {
      protocolVersion: 2,
      runs: [commandRun({ fromSeq: 10, toSeq: 12 })],
    })
    r.handlePlayerInputState(c, {
      protocolVersion: 2,
      runs: [commandRun({ fromSeq: 12, toSeq: 14 })],
    })

    expect(r.inputQueue.get("player-1")?.toArray().map((queued) => queued.seq))
      .toEqual([10, 11, 12, 13, 14])
  })

  it("drops fully stale v2 command runs", () => {
    const r = room()
    const c = client()

    r.handlePlayerInputState(c, {
      protocolVersion: 2,
      runs: [commandRun({ fromSeq: 10, toSeq: 12 })],
    })
    r.handlePlayerInputState(c, {
      protocolVersion: 2,
      runs: [commandRun({ fromSeq: 10, toSeq: 11 })],
    })

    expect(r.inputQueue.get("player-1")?.toArray().map((queued) => queued.seq))
      .toEqual([10, 11, 12])
  })

  it("uses the same stale-seq duplicate filter for v2 compact and full inputs", () => {
    const r = room()
    const c = client()

    r.handlePlayerInputState(c, compact({ fromSeq: 5 }))
    r.handlePlayerInput(c, input({ seq: 5 }))
    r.handlePlayerInputState(c, compact({ fromSeq: 6, buttons: 0 }))

    expect(r.inputQueue.get("player-1")?.toArray().map((queued) => queued.seq))
      .toEqual([5, 6])
  })

  it("rejects full and compact input outside active simulation", () => {
    const r = room()
    const c = client()
    Object.assign(r, { lobbyPhase: "LOBBY", simulation: null })

    r.handlePlayerInput(c, input())
    r.handlePlayerInputState(c, compact())

    expect(r.inputQueue.get("player-1")).toBeUndefined()
  })

  it("rejects malformed full and compact input payloads", () => {
    const r = room()
    const c = client()

    r.handlePlayerInput(c, { ...input(), seq: -1 })
    r.handlePlayerInputState(c, compact({ buttons: 64 }))

    expect(r.inputQueue.get("player-1")).toBeUndefined()
  })

  it("caps compact input queues with the same drop accounting as legacy input", () => {
    const r = room()
    const c = client()

    for (let seq = 0; seq < 40; seq++) {
      r.handlePlayerInputState(c, compact({ fromSeq: seq }))
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

  it("caps v2 command run queues with the same drop accounting", () => {
    const r = room()
    const c = client()

    r.handlePlayerInputState(c, {
      protocolVersion: 2,
      runs: [commandRun({ fromSeq: 0, toSeq: 29 })],
    })
    r.handlePlayerInputState(c, {
      protocolVersion: 2,
      runs: [commandRun({ fromSeq: 30, toSeq: 39 })],
    })

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
