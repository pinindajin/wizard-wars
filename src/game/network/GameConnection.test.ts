import { describe, it, expect, vi, beforeEach } from "vitest"

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

  it("registers explicit no-op handlers for silenced message types", () => {
    for (const type of [
      RoomEvent.PlayerJoin,
      RoomEvent.LobbyState,
      RoomEvent.LobbyChatHistory,
    ]) {
      expect(
        room.handlers.get(type),
        `expected handler registered for ${type}`,
      ).toBeDefined()
      expect((room.handlers.get(type)?.size ?? 0) > 0).toBe(true)
    }
  })

  it("wildcard handler is still registered alongside explicit silencers", () => {
    expect(room.handlers.get("*")).toBeDefined()
  })

  it("sendShopPurchase sends with correct RoomEvent key", () => {
    conn.sendShopPurchase("lightning_bolt")
    expect(room.sent).toContainEqual({
      type: RoomEvent.ShopPurchase,
      payload: { itemId: "lightning_bolt" },
    })
  })

  it("sendEquipItem sends equip_item with itemId", () => {
    conn.sendEquipItem("axe")
    expect(room.sent).toContainEqual({
      type: RoomEvent.EquipItem,
      payload: { itemId: "axe" },
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
      bare.sendEquipItem("x")
      bare.sendAssignAbility("x", 0)
      bare.sendUseQuickItem(0)
    }).not.toThrow()
  })
})
