import { describe, it, expect, beforeEach, vi } from "vitest"
import { NetworkSyncSystem } from "./NetworkSyncSystem"
import { ClientPosition, ClientPlayerState } from "../components"
import { addEntity, clientEntities, hasEntity, removeEntity } from "../world"
import type { GameStateSyncPayload, PlayerSnapshot } from "@/shared/types"

function baseSnapshot(over: Partial<PlayerSnapshot> & { id: number; playerId: string }): PlayerSnapshot {
  return {
    id: over.id,
    playerId: over.playerId,
    username: over.username ?? "u",
    x: over.x ?? 0,
    y: over.y ?? 0,
    facingAngle: over.facingAngle ?? 0,
    health: over.health ?? 10,
    maxHealth: over.maxHealth ?? 10,
    lives: over.lives ?? 3,
    heroId: over.heroId ?? "red_wizard",
    animState: over.animState ?? "idle",
    castingAbilityId: over.castingAbilityId ?? null,
    invulnerable: over.invulnerable ?? false,
  }
}

function clearClientEcs(): void {
  for (const id of [...clientEntities]) {
    removeEntity(id)
  }
  for (const k of Object.keys(ClientPosition)) {
    const n = Number(k)
    if (Number.isFinite(n)) delete ClientPosition[n]
  }
  for (const k of Object.keys(ClientPlayerState)) {
    const n = Number(k)
    if (Number.isFinite(n)) delete ClientPlayerState[n]
  }
}

describe("NetworkSyncSystem.applyFullSync (r5 despawn)", () => {
  const system = new NetworkSyncSystem()

  beforeEach(() => {
    clearClientEcs()
  })

  it("removes client ECS records for player ids not present in the new snapshot (T5)", () => {
    const a = baseSnapshot({ id: 1, playerId: "p1" })
    const b = baseSnapshot({ id: 2, playerId: "p2" })
    system.applyFullSync({ players: [a, b], fireballs: [], seq: 0 })
    expect(clientEntities.has(1)).toBe(true)
    expect(clientEntities.has(2)).toBe(true)
    expect(ClientPosition[1]).toBeDefined()
    expect(ClientPosition[2]).toBeDefined()

    system.applyFullSync({ players: [a], fireballs: [], seq: 0 })
    expect(clientEntities.has(1)).toBe(true)
    expect(clientEntities.has(2)).toBe(false)
    expect(hasEntity(2)).toBe(false)
    expect(ClientPosition[2]).toBeUndefined()
    expect(ClientPlayerState[2]).toBeUndefined()
  })

  it("rebuilds from empty after a shrink", () => {
    addEntity(99)
    ClientPosition[99] = { x: 1, y: 2 }
    ClientPlayerState[99] = {
      playerId: "x",
      username: "x",
      heroId: "red_wizard",
      health: 1,
      maxHealth: 1,
      lives: 1,
      animState: "idle",
      castingAbilityId: null,
      facingAngle: 0,
      invulnerable: false,
    }
    const snap = baseSnapshot({ id: 3, playerId: "only" })
    system.applyFullSync({ players: [snap], fireballs: [], seq: 0 })
    expect([...clientEntities].sort((x, y) => x - y)).toEqual([3])
    expect(ClientPosition[99]).toBeUndefined()
  })
})

describe("NetworkSyncSystem.applyFullSync (payload from GameStateSync)", () => {
  const system = new NetworkSyncSystem()

  beforeEach(() => {
    clearClientEcs()
  })

  it("accepts a full valid GameStateSyncPayload shape", () => {
    const payload: GameStateSyncPayload = {
      players: [baseSnapshot({ id: 0, playerId: "u0" })],
      fireballs: [],
      seq: 0,
    }
    system.applyFullSync(payload)
    expect(clientEntities.has(0)).toBe(true)
    expect(ClientPlayerState[0]!.playerId).toBe("u0")
  })
})

describe("NetworkSyncSystem.applyBatchUpdate", () => {
  beforeEach(() => {
    clearClientEcs()
  })

  it("applies x-only position deltas using the existing y position", () => {
    const onAuthoritativePosition = vi.fn()
    const system = new NetworkSyncSystem({ onAuthoritativePosition })

    system.applyFullSync({
      players: [baseSnapshot({ id: 1, playerId: "p1", x: 10, y: 20 })],
      fireballs: [],
      seq: 0,
    })

    system.applyBatchUpdate({
      deltas: [{ id: 1, x: 15 }],
      removedIds: [],
      seq: 0,
    })

    expect(ClientPosition[1]).toEqual({ x: 15, y: 20 })
    expect(onAuthoritativePosition).toHaveBeenLastCalledWith(
      1,
      15,
      20,
      "batch_update",
    )
  })

  it("applies y-only position deltas using the existing x position", () => {
    const onAuthoritativePosition = vi.fn()
    const system = new NetworkSyncSystem({ onAuthoritativePosition })

    system.applyFullSync({
      players: [baseSnapshot({ id: 1, playerId: "p1", x: 10, y: 20 })],
      fireballs: [],
      seq: 0,
    })

    system.applyBatchUpdate({
      deltas: [{ id: 1, y: 25 }],
      removedIds: [],
      seq: 0,
    })

    expect(ClientPosition[1]).toEqual({ x: 10, y: 25 })
    expect(onAuthoritativePosition).toHaveBeenLastCalledWith(
      1,
      10,
      25,
      "batch_update",
    )
  })
})
