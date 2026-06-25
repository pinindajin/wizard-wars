import { describe, it, expect, beforeEach, vi } from "vitest"
import { NetworkSyncSystem } from "./NetworkSyncSystem"
import { ClientPosition, ClientPlayerState } from "../components"
import { addEntity, clientEntities, hasEntity, removeEntity } from "../world"
import type {
  GameStateSyncPayload,
  PlayerOwnerAckPayload,
  PlayerSnapshot,
} from "@/shared/types"

function abilityStates() {
  return {
    fireball: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: null,
      maxCharges: null,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
    jump: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: 4,
      maxCharges: 4,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
  }
}

function baseSnapshot(over: Partial<PlayerSnapshot> & { id: number; playerId: string }): PlayerSnapshot {
  return {
    id: over.id,
    playerId: over.playerId,
    username: over.username ?? "u",
    x: over.x ?? 0,
    y: over.y ?? 0,
    vx: over.vx ?? 0,
    vy: over.vy ?? 0,
    facingAngle: over.facingAngle ?? 0,
    moveFacingAngle: over.moveFacingAngle ?? 0,
    health: over.health ?? 10,
    maxHealth: over.maxHealth ?? 10,
    lives: over.lives ?? 3,
    heroId: over.heroId ?? "red_wizard",
    animState: over.animState ?? "idle",
    moveState: over.moveState ?? "idle",
    terrainState: over.terrainState ?? "land",
    castingAbilityId: over.castingAbilityId ?? null,
    invulnerable: over.invulnerable ?? false,
    jumpZ: over.jumpZ ?? 0,
    jumpStartedInLava: over.jumpStartedInLava ?? false,
    hasSwiftBoots: over.hasSwiftBoots ?? false,
    abilityStates: over.abilityStates ?? abilityStates(),
    lastProcessedInputSeq: over.lastProcessedInputSeq ?? 0,
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
    system.applyFullSync({ players: [a, b], fireballs: [], seq: 0, serverTimeMs: 1 })
    expect(clientEntities.has(1)).toBe(true)
    expect(clientEntities.has(2)).toBe(true)
    expect(ClientPosition[1]).toBeDefined()
    expect(ClientPosition[2]).toBeDefined()

    system.applyFullSync({ players: [a], fireballs: [], seq: 0, serverTimeMs: 2 })
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
      moveState: "idle",
      terrainState: "land",
      castingAbilityId: null,
      facingAngle: 0,
      moveFacingAngle: 0,
      invulnerable: false,
      jumpZ: 0,
      jumpStartedInLava: false,
      hasSwiftBoots: false,
      abilityStates: abilityStates(),
    }
    const snap = baseSnapshot({ id: 3, playerId: "only" })
    system.applyFullSync({ players: [snap], fireballs: [], seq: 0, serverTimeMs: 3 })
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
      serverTimeMs: 42,
    }
    system.applyFullSync(payload)
    expect(clientEntities.has(0)).toBe(true)
    expect(ClientPlayerState[0]!.playerId).toBe("u0")
  })

  it("hydrates Swift Boots equipment state from full sync and player deltas", () => {
    const system = new NetworkSyncSystem()
    const payload: GameStateSyncPayload = {
      players: [baseSnapshot({ id: 1, playerId: "p1", hasSwiftBoots: true })],
      fireballs: [],
      seq: 0,
      serverTimeMs: 1_000,
    }

    system.applyFullSync(payload)
    expect(ClientPlayerState[1]?.hasSwiftBoots).toBe(true)

    system.applyBatchUpdate({
      deltas: [{ id: 1, hasSwiftBoots: false }],
      removedIds: [],
      seq: 1,
      serverTimeMs: 1_017,
    })

    expect(ClientPlayerState[1]?.hasSwiftBoots).toBe(false)
  })

  it("emits optional net timing from GameStateSync payloads", () => {
    const onNetTiming = vi.fn()
    const timing = {
      protocolVersion: 1 as const,
      tickRateHz: 60,
      tickMs: 1000 / 60,
      netSendRateHz: 30,
      netSendIntervalMs: 1000 / 30,
      remoteRenderDelayMs: 84,
    }
    const systemWithTiming = new NetworkSyncSystem({ onNetTiming })

    systemWithTiming.applyFullSync({
      players: [baseSnapshot({ id: 0, playerId: "u0" })],
      fireballs: [],
      seq: 0,
      serverTimeMs: 42,
      timing,
    })

    expect(onNetTiming).toHaveBeenCalledWith(timing)
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
      serverTimeMs: 1,
    })

    system.applyBatchUpdate({
      deltas: [{ id: 1, x: 15 }],
      removedIds: [],
      seq: 0,
      serverTimeMs: 2,
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
      serverTimeMs: 3,
    })

    system.applyBatchUpdate({
      deltas: [{ id: 1, y: 25 }],
      removedIds: [],
      seq: 0,
      serverTimeMs: 4,
    })

    expect(ClientPosition[1]).toEqual({ x: 10, y: 25 })
    expect(onAuthoritativePosition).toHaveBeenLastCalledWith(
      1,
      10,
      25,
      "batch_update",
    )
  })

  it("applies ability runtime state from full sync and batch deltas", () => {
    const system = new NetworkSyncSystem()
    const updated = {
      ...abilityStates(),
      jump: {
        cooldownEndsAtServerTimeMs: 6_000,
        cooldownDurationMs: 5_000,
        charges: 0,
        maxCharges: 4,
        rechargeEndsAtServerTimeMs: 6_000,
        rechargeDurationMs: 5_000,
      },
    }

    system.applyFullSync({
      players: [baseSnapshot({ id: 1, playerId: "p1" })],
      fireballs: [],
      seq: 0,
      serverTimeMs: 1,
    })
    system.applyBatchUpdate({
      deltas: [{ id: 1, abilityStates: updated }],
      removedIds: [],
      seq: 0,
      serverTimeMs: 2,
    })

    expect(ClientPlayerState[1]!.abilityStates.jump.charges).toBe(0)
    expect(ClientPlayerState[1]!.abilityStates.jump.cooldownEndsAtServerTimeMs).toBe(6_000)
  })

  it("keeps legacy visual batch ACK fallback for the local player", () => {
    const onLocalAck = vi.fn()
    const system = new NetworkSyncSystem({ onLocalAck })
    system.localPlayerId = "p1"
    system.applyFullSync({
      players: [baseSnapshot({ id: 1, playerId: "p1", x: 10, y: 20 })],
      fireballs: [],
      seq: 0,
      serverTimeMs: 1,
    })

    system.applyBatchUpdate({
      deltas: [{ id: 1, x: 15, y: 25, lastProcessedInputSeq: 3 }],
      removedIds: [],
      seq: 1,
      serverTimeMs: 2,
    })

    expect(onLocalAck).toHaveBeenCalledWith({
      id: 1,
      x: 15,
      y: 25,
      lastProcessedInputSeq: 3,
    })
  })

  it("keeps legacy batch ACK fallback for seq 0 after a pre-first-input full sync", () => {
    const onLocalAck = vi.fn()
    const system = new NetworkSyncSystem({ onLocalAck })
    system.localPlayerId = "p1"
    system.applyFullSync({
      players: [baseSnapshot({ id: 1, playerId: "p1", lastProcessedInputSeq: 0 })],
      fireballs: [],
      seq: 0,
      serverTimeMs: 1,
    })

    system.applyBatchUpdate({
      deltas: [{ id: 1, x: 15, y: 25, lastProcessedInputSeq: 0 }],
      removedIds: [],
      seq: 1,
      serverTimeMs: 2,
    })

    expect(onLocalAck).toHaveBeenCalledWith({
      id: 1,
      x: 15,
      y: 25,
      lastProcessedInputSeq: 0,
    })
  })
})

describe("NetworkSyncSystem.applyOwnerAck", () => {
  beforeEach(() => {
    clearClientEcs()
  })

  it("routes dedicated owner ACKs without mutating visual ECS position", () => {
    const onLocalAck = vi.fn()
    const onServerTime = vi.fn()
    const system = new NetworkSyncSystem({ onLocalAck, onServerTime })
    system.localPlayerId = "p1"
    system.applyFullSync({
      players: [baseSnapshot({ id: 1, playerId: "p1", x: 10, y: 20 })],
      fireballs: [],
      seq: 0,
      serverTimeMs: 1,
    })
    const ack = ownerAck({ id: 1, playerId: "p1", lastProcessedInputSeq: 4 })

    system.applyOwnerAck(ack)

    expect(onServerTime).toHaveBeenCalledWith(ack.serverTimeMs)
    expect(onLocalAck).toHaveBeenCalledWith({
      id: 1,
      x: ack.x,
      y: ack.y,
      vx: ack.vx,
      vy: ack.vy,
      lastProcessedInputSeq: ack.lastProcessedInputSeq,
      replayContext: ack.replayContext,
    })
    expect(ClientPosition[1]).toEqual({ x: 10, y: 20 })
  })

  it("ignores remote and duplicate owner ACKs", () => {
    const onLocalAck = vi.fn()
    const system = new NetworkSyncSystem({ onLocalAck })
    system.localPlayerId = "p1"
    system.applyFullSync({
      players: [baseSnapshot({ id: 1, playerId: "p1" })],
      fireballs: [],
      seq: 0,
      serverTimeMs: 1,
    })

    system.applyOwnerAck(ownerAck({ id: 1, playerId: "p2", lastProcessedInputSeq: 4 }))
    system.applyOwnerAck(ownerAck({ id: 1, playerId: "p1", lastProcessedInputSeq: 4 }))
    system.applyOwnerAck(ownerAck({ id: 1, playerId: "p1", lastProcessedInputSeq: 4 }))
    system.applyOwnerAck(ownerAck({ id: 1, playerId: "p1", lastProcessedInputSeq: 3 }))
    system.applyOwnerAck(ownerAck({ id: 1, playerId: "p1", lastProcessedInputSeq: 5 }))

    expect(onLocalAck.mock.calls.map(([sample]) => sample.lastProcessedInputSeq)).toEqual([
      4,
      5,
    ])
  })

  it("accepts the first local owner ACK without a prior full sync cursor", () => {
    const onLocalAck = vi.fn()
    const system = new NetworkSyncSystem({ onLocalAck })
    system.localPlayerId = "p1"

    system.applyOwnerAck(ownerAck({ id: 1, playerId: "p1", lastProcessedInputSeq: 0 }))

    expect(onLocalAck).toHaveBeenCalledWith(
      expect.objectContaining({ lastProcessedInputSeq: 0 }),
    )
  })

  it("accepts the first seq 0 owner ACK after a pre-first-input full sync", () => {
    const onLocalAck = vi.fn()
    const system = new NetworkSyncSystem({ onLocalAck })
    system.localPlayerId = "p1"
    system.applyFullSync({
      players: [baseSnapshot({ id: 1, playerId: "p1", lastProcessedInputSeq: 0 })],
      fireballs: [],
      seq: 0,
      serverTimeMs: 1,
    })

    system.applyOwnerAck(ownerAck({ id: 1, playerId: "p1", lastProcessedInputSeq: 0 }))

    expect(onLocalAck).toHaveBeenCalledWith(
      expect.objectContaining({ lastProcessedInputSeq: 0 }),
    )
  })

  it("does not treat nonzero full sync cursors as pending first seq 0 ACKs", () => {
    const onLocalAck = vi.fn()
    const system = new NetworkSyncSystem({ onLocalAck })
    system.localPlayerId = "p1"
    system.applyFullSync({
      players: [baseSnapshot({ id: 1, playerId: "p1", lastProcessedInputSeq: 3 })],
      fireballs: [],
      seq: 0,
      serverTimeMs: 1,
    })

    system.applyOwnerAck(ownerAck({ id: 1, playerId: "p1", lastProcessedInputSeq: 3 }))
    system.applyOwnerAck(ownerAck({ id: 1, playerId: "p1", lastProcessedInputSeq: 4 }))

    expect(onLocalAck.mock.calls.map(([sample]) => sample.lastProcessedInputSeq)).toEqual([4])
  })
})

function ownerAck(
  overrides: Partial<PlayerOwnerAckPayload> & {
    id: number
    playerId: string
    lastProcessedInputSeq: number
  },
): PlayerOwnerAckPayload {
  return {
    id: overrides.id,
    playerId: overrides.playerId,
    x: overrides.x ?? 100,
    y: overrides.y ?? 120,
    vx: overrides.vx ?? 10,
    vy: overrides.vy ?? 0,
    lastProcessedInputSeq: overrides.lastProcessedInputSeq,
    serverTimeMs: overrides.serverTimeMs ?? 5_000,
    replayContext: overrides.replayContext ?? {
      moveState: "idle",
      terrainState: "land",
      castingAbilityId: null,
      jumpZ: 0,
      jumpStartedInLava: false,
      isSwinging: false,
      hasSwiftBoots: false,
    },
  }
}
