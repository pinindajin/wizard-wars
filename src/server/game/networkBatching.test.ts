import { describe, expect, it } from "vitest"

import {
  FireballVisualBatchCoalescer,
  HomingOrbVisualBatchCoalescer,
  PlayerVisualBatchCoalescer,
  mergeFireballBatch,
  mergeHomingOrbBatch,
  mergePlayerBatch,
} from "./networkBatching"

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

describe("server network batching", () => {
  it("merges player visual deltas by entity id with later fields winning and strips ACK cursors", () => {
    const merged = mergePlayerBatch([
      [{ id: 1, x: 10, y: 20, lastProcessedInputSeq: 1 }],
      [{ id: 1, x: 12, health: 80 }, { id: 2, x: 5 }],
    ])

    expect(merged).toEqual([
      { id: 1, x: 12, y: 20, health: 80 },
      { id: 2, x: 5 },
    ])
  })

  it("drops ACK-only player visual deltas instead of retaining id-only rows", () => {
    const coalescer = new PlayerVisualBatchCoalescer()

    coalescer.ingest([
      { id: 1, lastProcessedInputSeq: 4 },
      { id: 2, lastProcessedInputSeq: 8 },
    ])

    expect(coalescer.hasPending()).toBe(false)
    expect(coalescer.flush()).toEqual([])
  })

  it("merges fireball deltas and keeps removed ids unique", () => {
    const merged = mergeFireballBatch([
      { deltas: [{ id: 3, x: 10, y: 10 }], removedIds: [4] },
      { deltas: [{ id: 3, x: 11, y: 12 }], removedIds: [4, 5] },
    ])

    expect(merged).toEqual({
      deltas: [{ id: 3, x: 11, y: 12 }],
      removedIds: [4, 5],
    })
  })

  it("drops stale fireball removals when a later delta reuses the id", () => {
    const merged = mergeFireballBatch([
      { deltas: [], removedIds: [7] },
      { deltas: [{ id: 7, x: 25, y: 35 }], removedIds: [] },
    ])

    expect(merged).toEqual({
      deltas: [{ id: 7, x: 25, y: 35 }],
      removedIds: [],
    })
  })

  it("drops stale fireball deltas when a later removal wins for the id", () => {
    const merged = mergeFireballBatch([
      { deltas: [{ id: 8, x: 50, y: 60 }], removedIds: [] },
      { deltas: [], removedIds: [8] },
    ])

    expect(merged).toEqual({
      deltas: [],
      removedIds: [8],
    })
  })

  it("preserves the newest fireball server time while merging movement batches", () => {
    const merged = mergeFireballBatch([
      {
        deltas: [{ id: 9, x: 1, y: 2 }],
        removedIds: [],
        serverTimeMs: 1_000,
      },
      {
        deltas: [{ id: 9, x: 3, y: 4 }],
        removedIds: [],
        serverTimeMs: 1_017,
      },
    ])

    expect(merged).toEqual({
      deltas: [{ id: 9, x: 3, y: 4 }],
      removedIds: [],
      serverTimeMs: 1_017,
    })
  })

  it("merges homing orb deltas and lets removals win per id", () => {
    const merged = mergeHomingOrbBatch([
      {
        deltas: [{ id: 9, x: 1, y: 2, vx: 3, vy: 4, headingRad: 0.1 }],
        removedIds: [10],
      },
      {
        deltas: [{ id: 9, x: 5, y: 6, vx: 7, vy: 8, headingRad: 0.2, targetId: "p2" }],
        removedIds: [9],
      },
      {
        deltas: [{ id: 10, x: 11, y: 12, vx: 13, vy: 14, headingRad: 0.3 }],
        removedIds: [],
      },
    ])

    expect(merged).toEqual({
      deltas: [{ id: 10, x: 11, y: 12, vx: 13, vy: 14, headingRad: 0.3 }],
      removedIds: [9],
    })
  })

  it("preserves sparse Homing Orb fields and explicit target clears while merging", () => {
    const merged = mergeHomingOrbBatch([
      {
        deltas: [{ id: 12, x: 1, y: 2, targetId: "target-a" }],
        removedIds: [],
        serverTimeMs: 1_000,
      },
      {
        deltas: [{ id: 12, vx: 3, vy: 4, headingRad: 0.5, targetId: null }],
        removedIds: [],
        serverTimeMs: 1_017,
      },
    ])

    expect(merged).toEqual({
      deltas: [{ id: 12, x: 1, y: 2, targetId: null, vx: 3, vy: 4, headingRad: 0.5 }],
      removedIds: [],
      serverTimeMs: 1_017,
    })
  })

  it("coalesces player deltas incrementally and snapshots nested ability state", () => {
    const coalescer = new PlayerVisualBatchCoalescer()
    const first = {
      id: 1,
      x: 10,
      moveFacingAngle: 0.25,
      castingAbilityId: "fireball",
      jumpStartedInLava: false,
      abilityStates: abilityStates(2),
      lastProcessedInputSeq: 4,
    }

    coalescer.ingest([first])
    first.x = 999
    first.abilityStates.fireball.charges = 0
    coalescer.ingest([
      {
        id: 1,
        y: 20,
        vx: 1.5,
        vy: -2.5,
        facingAngle: 1.25,
        moveFacingAngle: 0.5,
        castingAbilityId: null,
        jumpStartedInLava: true,
        lives: 2,
        animState: "walk",
        moveState: "moving",
        terrainState: "lava",
        invulnerable: false,
        jumpZ: 7,
        hasSwiftBoots: true,
        lastProcessedInputSeq: 5,
      },
      { id: 2, x: 5 },
    ])

    expect(coalescer.flush()).toEqual([
      {
        id: 1,
        x: 10,
        vx: 1.5,
        vy: -2.5,
        facingAngle: 1.25,
        moveFacingAngle: 0.5,
        castingAbilityId: null,
        jumpStartedInLava: true,
        lives: 2,
        animState: "walk",
        moveState: "moving",
        terrainState: "lava",
        invulnerable: false,
        jumpZ: 7,
        hasSwiftBoots: true,
        abilityStates: abilityStates(2),
        y: 20,
      },
      { id: 2, x: 5 },
    ])
    expect(coalescer.hasPending()).toBe(false)
  })

  it("coalesces fireball deltas incrementally with id reuse and snapshot isolation", () => {
    const coalescer = new FireballVisualBatchCoalescer()
    const reused = { id: 8, x: 25, y: 35 }

    coalescer.ingest({
      deltas: [{ id: 7, x: 10, y: 20 }],
      removedIds: [8],
      serverTimeMs: 1_000,
    })
    coalescer.ingest({
      deltas: [reused],
      removedIds: [7],
      serverTimeMs: 1_017,
    })
    reused.x = 999

    expect(coalescer.flush()).toEqual({
      deltas: [{ id: 8, x: 25, y: 35 }],
      removedIds: [7],
      serverTimeMs: 1_017,
    })
    expect(coalescer.hasPending()).toBe(false)
  })

  it("ignores empty fireball batches without retaining server time", () => {
    const coalescer = new FireballVisualBatchCoalescer()

    coalescer.ingest({ deltas: [], removedIds: [], serverTimeMs: 2_000 })

    expect(coalescer.hasPending()).toBe(false)
    expect(coalescer.flush()).toEqual({ deltas: [], removedIds: [] })
  })

  it("coalesces Homing Orb sparse deltas incrementally and snapshots rows", () => {
    const coalescer = new HomingOrbVisualBatchCoalescer()
    const first = { id: 12, x: 1, y: 2, targetId: "target-a" }
    const second = { id: 12, vx: 3, vy: 4, headingRad: 0.5, targetId: null }

    coalescer.ingest({
      deltas: [first],
      removedIds: [],
      serverTimeMs: 1_000,
    })
    first.x = 999
    coalescer.ingest({
      deltas: [second],
      removedIds: [],
      serverTimeMs: 1_017,
    })
    second.vx = 999

    expect(coalescer.flush()).toEqual({
      deltas: [{ id: 12, x: 1, y: 2, targetId: null, vx: 3, vy: 4, headingRad: 0.5 }],
      removedIds: [],
      serverTimeMs: 1_017,
    })
    expect(coalescer.hasPending()).toBe(false)
  })
})
