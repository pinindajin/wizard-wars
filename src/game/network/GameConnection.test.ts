import { describe, it, expect, beforeEach, vi } from "vitest"

import { GameConnection } from "./GameConnection"
import { RoomEvent } from "@/shared/roomEvents"
import { WsEvent } from "@/shared/events"
import { CLOSE_CODE_ADMIN_CLOSED } from "@/shared/constants"

type Handler = (typeOrType: unknown, payload?: unknown) => void

/**
 * Minimal fake `Room` that records `onMessage` registrations and `send` calls.
 */
function makeFakeRoom() {
  const handlers = new Map<string, Set<Handler>>()
  const sent: Array<{ type: string; payload: unknown }> = []
  let leaveHandler: ((code: number) => void | Promise<void>) | null = null
  return {
    sessionId: "s-1",
    roomId: "r-1",
    reconnectionToken: "reconnect-token",
    onMessage(type: string | "*", fn: Handler) {
      const key = String(type)
      if (!handlers.has(key)) handlers.set(key, new Set())
      handlers.get(key)!.add(fn)
      return () => handlers.get(key)?.delete(fn)
    },
    send(type: string, payload: unknown) {
      sent.push({ type, payload })
    },
    onLeave(fn: (code: number) => void | Promise<void>) {
      leaveHandler = fn
    },
    onError() {},
    leave() {
      return Promise.resolve()
    },
    handlers,
    sent,
    wildcardCount(): number {
      return handlers.get("*")?.size ?? 0
    },
    triggerMessage(type: string, payload: unknown) {
      for (const handler of handlers.get("*") ?? []) {
        handler(type, payload)
      }
    },
    async triggerLeave(code: number) {
      await leaveHandler?.(code)
    },
  }
}

describe("GameConnection send helpers + warning silence", () => {
  let room: ReturnType<typeof makeFakeRoom>
  let conn: GameConnection

  beforeEach(() => {
    room = makeFakeRoom()
    conn = new GameConnection({ serverUrl: "ws://ignored", token: "t" })
    // Inject the fake room and wire the listeners the same way `connectById` would.
    ;(conn as unknown as { _room: unknown })._room = room
    ;(conn as unknown as { wireRoomListeners: () => void }).wireRoomListeners()
  })

  it("registers a wildcard handler for all server broadcasts", () => {
    expect(room.handlers.get("*")).toBeDefined()
    expect((room.handlers.get("*")?.size ?? 0) > 0).toBe(true)
  })

  it("removes the previous wildcard listener when wireRoomListeners runs again (reconnect)", () => {
    const wire = (conn as unknown as { wireRoomListeners: () => void }).wireRoomListeners.bind(conn)
    expect(room.wildcardCount()).toBe(1)
    wire()
    expect(room.wildcardCount()).toBe(1)
    wire()
    expect(room.wildcardCount()).toBe(1)
  })

  it("does NOT register specific handlers for server-only broadcasts (wildcard only)", () => {
    // If GameConnection registered specific handlers for these types, the
    // Colyseus SDK's `dispatchMessage` would route ONLY to that handler and
    // skip the wildcard — dropping the payloads that LobbyConnectionProvider
    // needs to forward to React via WsEvent.LobbyState etc.
    for (const type of [
      RoomEvent.PlayerJoin,
      RoomEvent.LobbyState,
      RoomEvent.LobbyChatHistory,
    ]) {
      expect(
        room.handlers.get(type),
        `expected NO specific handler for ${type} (must flow through wildcard)`,
      ).toBeUndefined()
    }
  })

  it("maps LobbyAdminClosing through the wildcard message bridge", () => {
    const seen: unknown[] = []
    conn.onMessage((message) => {
      seen.push(message)
    })

    const payload = {
      reason: "admin_closed",
      closeAtServerMs: 123,
      countdownMs: 1000,
      message: "Closing",
    }
    room.triggerMessage(RoomEvent.LobbyAdminClosing, payload)

    expect(seen).toContainEqual({
      type: WsEvent.LobbyAdminClosing,
      payload,
    })
  })

  it("forwards server performance status through the wildcard message bridge", () => {
    const seen: unknown[] = []
    conn.onMessage((message) => {
      seen.push(message)
    })

    const payload = {
      serverTimeMs: 1000,
      degraded: true,
      reasons: ["dropped_debt"],
      metrics: {
        windowMs: 1000,
        droppedDebtMs: 16,
        catchUpCallbacks: 0,
        inputQueueDrops: 0,
        simDurationMs: 5,
        broadcastDurationMs: 1,
        eventLoopLagMs: 0,
        processCpuPercent: 10,
        heapUsedBytes: 1,
        rssBytes: 2,
        activeRooms: 1,
        connectedClients: 1,
      },
    }
    room.triggerMessage(RoomEvent.ServerPerformanceStatus, payload)

    expect(seen).toContainEqual({
      type: WsEvent.ServerPerformanceStatus,
      payload,
    })
  })

  it("forwards owner ACKs through the wildcard message bridge", () => {
    const seen: unknown[] = []
    conn.onMessage((message) => {
      seen.push(message)
    })

    const payload = {
      id: 1,
      playerId: "player-1",
      x: 10,
      y: 20,
      vx: 0,
      vy: 0,
      lastProcessedInputSeq: 4,
      serverTimeMs: 1234,
      replayContext: {
        moveState: "idle",
        terrainState: "land",
        castingAbilityId: null,
        jumpZ: 0,
        jumpStartedInLava: false,
        isSwinging: false,
        hasSwiftBoots: false,
      },
    }
    room.triggerMessage(RoomEvent.PlayerOwnerAck, payload)

    expect(seen).toContainEqual({
      type: WsEvent.PlayerOwnerAck,
      payload,
    })
  })

  it("notifies connection health subscribers during reconnect transitions", async () => {
    const health: string[] = []
    conn.onConnectionHealthChange((next) => {
      health.push(next)
    })
    const reconnect = vi.fn().mockResolvedValue(room)
    ;(conn as unknown as { client: { reconnect: typeof reconnect } }).client = { reconnect }

    await room.triggerLeave(1006)

    expect(health).toEqual(["reconnecting", "connected"])
  })

  it("notifies connection health subscribers when reconnect fails", async () => {
    const health: string[] = []
    conn.onConnectionHealthChange((next) => {
      health.push(next)
    })
    const reconnect = vi.fn().mockRejectedValue(new Error("gone"))
    ;(conn as unknown as { client: { reconnect: typeof reconnect } }).client = { reconnect }

    await room.triggerLeave(1006)

    expect(health).toEqual(["reconnecting", "disconnected"])
  })

  it("does not attempt reconnect after LobbyAdminClosing", async () => {
    const reconnect = vi.fn()
    ;(conn as unknown as { client: { reconnect: typeof reconnect } }).client = { reconnect }

    room.triggerMessage(RoomEvent.LobbyAdminClosing, {
      reason: "admin_closed",
      closeAtServerMs: 123,
      countdownMs: 1000,
      message: "Closing",
    })
    await room.triggerLeave(4012)

    expect(reconnect).not.toHaveBeenCalled()
  })

  it("does not attempt reconnect on admin close code", async () => {
    const reconnect = vi.fn()
    ;(conn as unknown as { client: { reconnect: typeof reconnect } }).client = { reconnect }

    await room.triggerLeave(CLOSE_CODE_ADMIN_CLOSED)

    expect(reconnect).not.toHaveBeenCalled()
  })

  it("sendShopPurchase sends with correct RoomEvent key", () => {
    conn.sendShopPurchase("lightning_bolt")
    expect(room.sent).toContainEqual({
      type: RoomEvent.ShopPurchase,
      payload: { itemId: "lightning_bolt" },
    })
  })

  it("sendPlayerInputState sends compact input on the additive room event", () => {
    const payload = {
      protocolVersion: 2,
      runs: [
        {
          fromSeq: 4,
          toSeq: 4,
          clientSendTimeMs: 1_000,
          buttons: 1,
          targetX: 10,
          targetY: 20,
        },
      ],
    } as const

    conn.sendPlayerInputState(payload)

    expect(room.sent).toContainEqual({
      type: RoomEvent.PlayerInputState,
      payload,
    })
  })

  it("sendPlayerInputState samples v2 input state by newest covered command sequence", () => {
    const payload = {
      protocolVersion: 2,
      runs: [
        {
          fromSeq: 4,
          toSeq: 7,
          clientSendTimeMs: 1_000,
          buttons: 1,
          targetX: 10,
          targetY: 20,
        },
      ],
    } as const

    conn.sendPlayerInputState(payload)
    conn.sendPlayerInputState({ protocolVersion: 2, runs: [] })

    expect(room.sent).toContainEqual({
      type: RoomEvent.PlayerInputState,
      payload,
    })
  })

  it("sendAssignAbility sends assign_ability with itemId and slotIndex", () => {
    conn.sendAssignAbility("lightning_bolt", 2)
    expect(room.sent).toContainEqual({
      type: RoomEvent.AssignAbility,
      payload: { itemId: "lightning_bolt", slotIndex: 2 },
    })
  })

  it("sendUseQuickItem sends use_quick_item with slotIndex", () => {
    conn.sendUseQuickItem(3)
    expect(room.sent).toContainEqual({
      type: RoomEvent.UseQuickItem,
      payload: { slotIndex: 3 },
    })
  })

  it("is a no-op when room is null", () => {
    const bare = new GameConnection({ serverUrl: "ws://x", token: "t" })
    // Should not throw
    expect(() => {
      bare.sendShopPurchase("x")
      bare.sendAssignAbility("x", 0)
      bare.sendUseQuickItem(0)
    }).not.toThrow()
  })
})
