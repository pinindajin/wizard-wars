import { describe, expect, it } from "vitest"

import {
  FireballVisualBatchCoalescer,
  HomingOrbVisualBatchCoalescer,
  PlayerVisualBatchCoalescer,
  splitPlayerDeltaForVisualBudget,
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
    expect(coalescer.peek(1)).toBeNull()
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

  it("flushes player visuals within caps and forces rows after max deferral age", () => {
    const coalescer = new PlayerVisualBatchCoalescer()
    coalescer.ingest([
      { id: 1, x: 1 },
      { id: 2, x: 2 },
      { id: 3, x: 3 },
    ], 1_000)

    expect(
      coalescer.flushBudgeted({
        maxDeltas: 1,
        maxRemovals: 0,
        maxBytes: 0,
        maxDeferralMs: 250,
        serverTimeMs: 1_100,
      }),
    ).toEqual({
      deltas: [{ id: 1, x: 1 }],
      deferredEntities: 2,
      maxDeferredAgeMs: 100,
    })

    coalescer.ingest([{ id: 2, x: 22 }], 1_200)

    expect(
      coalescer.flushBudgeted({
        maxDeltas: 1,
        maxRemovals: 0,
        maxBytes: 0,
        maxDeferralMs: 250,
        serverTimeMs: 1_300,
      }),
    ).toEqual({
      deltas: [
        { id: 2, x: 22 },
        { id: 3, x: 3 },
      ],
      deferredEntities: 0,
      maxDeferredAgeMs: 300,
    })
    expect(coalescer.hasPending()).toBe(false)
  })

  it("applies byte budgets across sparse player visual field types", () => {
    const coalescer = new PlayerVisualBatchCoalescer()
    coalescer.ingest([
      {
        id: 1,
        x: 1,
        animState: "walk",
        castingAbilityId: null,
        hasSwiftBoots: true,
        abilityStates: abilityStates(1),
      },
      { id: 2, x: 2 },
    ], 1_000)

    expect(
      coalescer.flushBudgeted({
        maxDeltas: 0,
        maxRemovals: 0,
        maxBytes: 10_000,
        maxDeferralMs: 250,
        serverTimeMs: 1_100,
      }),
    ).toEqual({
      deltas: [
        {
          id: 1,
          x: 1,
          animState: "walk",
          castingAbilityId: null,
          hasSwiftBoots: true,
          abilityStates: abilityStates(1),
        },
        { id: 2, x: 2 },
      ],
      deferredEntities: 0,
      maxDeferredAgeMs: 100,
    })
  })

  it("splits mixed player deltas into critical semantic and budgetable visual rows", () => {
    const split = splitPlayerDeltaForVisualBudget({
      id: 7,
      x: 10,
      y: 20,
      vx: 1,
      vy: 2,
      facingAngle: 0.25,
      moveFacingAngle: 0.5,
      health: 80,
      lives: 2,
      animState: "jump",
      moveState: "moving",
      terrainState: "lava",
      castingAbilityId: "fireball",
      invulnerable: true,
      jumpZ: 6,
      jumpStartedInLava: true,
      hasSwiftBoots: true,
      abilityStates: abilityStates(1),
      lastProcessedInputSeq: 99,
    })

    expect(split).toEqual({
      critical: {
        id: 7,
        health: 80,
        lives: 2,
        animState: "jump",
        moveState: "moving",
        terrainState: "lava",
        castingAbilityId: "fireball",
        invulnerable: true,
        jumpZ: 6,
        jumpStartedInLava: true,
        hasSwiftBoots: true,
        abilityStates: abilityStates(1),
      },
      visual: {
        id: 7,
        x: 10,
        y: 20,
        vx: 1,
        vy: 2,
        facingAngle: 0.25,
        moveFacingAngle: 0.5,
      },
    })
  })

  it("sends mouse-aim facing immediately with the paired movement sample", () => {
    const split = splitPlayerDeltaForVisualBudget({
      id: 7,
      x: 10,
      y: 20,
      vx: 1,
      vy: 2,
      facingAngle: 0.25,
      moveFacingAngle: 0.5,
      animState: "light_cast",
      castingAbilityId: "fireball",
    })

    expect(split).toEqual({
      critical: {
        id: 7,
        x: 10,
        y: 20,
        vx: 1,
        vy: 2,
        facingAngle: 0.25,
        moveFacingAngle: 0.5,
        animState: "light_cast",
        castingAbilityId: "fireball",
      },
      visual: null,
    })
  })

  it("does not classify ACK-only or semantic-only player deltas as budgetable visuals", () => {
    expect(splitPlayerDeltaForVisualBudget({ id: 1, lastProcessedInputSeq: 4 })).toEqual({
      critical: null,
      visual: null,
    })

    expect(
      splitPlayerDeltaForVisualBudget({
        id: 2,
        health: 50,
        terrainState: "lava",
      }),
    ).toEqual({
      critical: { id: 2, health: 50, terrainState: "lava" },
      visual: null,
    })
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

  it("flushes fireball visuals and removals within caps and retains deferrals", () => {
    const coalescer = new FireballVisualBatchCoalescer()
    coalescer.ingest({
      deltas: [
        { id: 1, x: 10, y: 20 },
        { id: 2, x: 30, y: 40 },
      ],
      removedIds: [3, 4],
      serverTimeMs: 1_000,
    })

    expect(
      coalescer.flushBudgeted({
        maxDeltas: 1,
        maxRemovals: 1,
        maxBytes: 0,
        maxDeferralMs: 250,
        serverTimeMs: 1_100,
      }),
    ).toEqual({
      batch: {
        deltas: [{ id: 1, x: 10, y: 20 }],
        removedIds: [3],
        serverTimeMs: 1_000,
      },
      deferredEntities: 2,
      maxDeferredAgeMs: 100,
    })

    expect(
      coalescer.flushBudgeted({
        maxDeltas: 1,
        maxRemovals: 1,
        maxBytes: 0,
        maxDeferralMs: 250,
        serverTimeMs: 1_300,
      }),
    ).toEqual({
      batch: {
        deltas: [{ id: 2, x: 30, y: 40 }],
        removedIds: [4],
        serverTimeMs: 1_000,
      },
      deferredEntities: 0,
      maxDeferredAgeMs: 300,
    })
  })

  it("tracks untimestamped fireball removals without forcing negative ages", () => {
    const coalescer = new FireballVisualBatchCoalescer()
    coalescer.ingest({
      deltas: [],
      removedIds: [9, 10],
    })

    expect(
      coalescer.flushBudgeted({
        maxDeltas: 0,
        maxRemovals: 1,
        maxBytes: 10_000,
        maxDeferralMs: 250,
        serverTimeMs: 1_100,
      }),
    ).toEqual({
      batch: {
        deltas: [],
        removedIds: [9],
      },
      deferredEntities: 1,
      maxDeferredAgeMs: 0,
    })
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

  it("flushes Homing Orb visuals and removals within caps and retains deferrals", () => {
    const coalescer = new HomingOrbVisualBatchCoalescer()
    coalescer.ingest({
      deltas: [
        { id: 1, x: 10, y: 20, targetId: "target-a" },
        { id: 2, x: 30, y: 40, targetId: null },
      ],
      removedIds: [3, 4],
      serverTimeMs: 1_000,
    })

    expect(
      coalescer.flushBudgeted({
        maxDeltas: 1,
        maxRemovals: 1,
        maxBytes: 0,
        maxDeferralMs: 250,
        serverTimeMs: 1_100,
      }),
    ).toEqual({
      batch: {
        deltas: [{ id: 1, x: 10, y: 20, targetId: "target-a" }],
        removedIds: [3],
        serverTimeMs: 1_000,
      },
      deferredEntities: 2,
      maxDeferredAgeMs: 100,
    })

    expect(
      coalescer.flushBudgeted({
        maxDeltas: 1,
        maxRemovals: 1,
        maxBytes: 0,
        maxDeferralMs: 250,
        serverTimeMs: 1_300,
      }),
    ).toEqual({
      batch: {
        deltas: [{ id: 2, x: 30, y: 40, targetId: null }],
        removedIds: [4],
        serverTimeMs: 1_000,
      },
      deferredEntities: 0,
      maxDeferredAgeMs: 300,
    })
  })

  it("tracks untimestamped Homing Orb removals without retaining server time", () => {
    const coalescer = new HomingOrbVisualBatchCoalescer()
    coalescer.ingest({
      deltas: [{ id: 5, x: 50 }],
      removedIds: [6, 7],
    })

    expect(
      coalescer.flushBudgeted({
        maxDeltas: 0,
        maxRemovals: 1,
        maxBytes: 10_000,
        maxDeferralMs: 250,
        serverTimeMs: 1_100,
      }),
    ).toEqual({
      batch: {
        deltas: [{ id: 5, x: 50 }],
        removedIds: [6],
      },
      deferredEntities: 1,
      maxDeferredAgeMs: 0,
    })
  })
})
