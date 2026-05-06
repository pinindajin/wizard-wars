import { describe, it, expect, beforeEach } from "vitest"

import { GameConnection } from "./GameConnection"
import { RoomEvent } from "@/shared/roomEvents"

type Handler = (typeOrType: unknown, payload?: unknown) => void

/**
 * Minimal fake `Room` that records `onMessage` registrations and `send` calls.
 */
function makeFakeRoom() {
  const handlers = new Map<string, Set<Handler>>()
  const sent: Array<{ type: string; payload: unknown }> = []
  return {
    sessionId: "s-1",
    onMessage(type: string | "*", fn: Handler) {
      const key = String(type)
      if (!handlers.has(key)) handlers.set(key, new Set())
      handlers.get(key)!.add(fn)
      return () => handlers.get(key)?.delete(fn)
    },
    send(type: string, payload: unknown) {
      sent.push({ type, payload })
    },
    onLeave(_fn: () => void) {},
    onError(_fn: () => void) {},
    leave() {
      return Promise.resolve()
    },
    handlers,
    sent,
    wildcardCount(): number {
      return handlers.get("*")?.size ?? 0
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

  it("sendShopPurchase sends with correct RoomEvent key", () => {
    conn.sendShopPurchase("lightning_bolt")
    expect(room.sent).toContainEqual({
      type: RoomEvent.ShopPurchase,
      payload: { itemId: "lightning_bolt" },
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
