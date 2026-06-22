import { describe, expect, it } from "vitest"

import { mergeFireballBatch, mergeHomingOrbBatch, mergePlayerBatch } from "./networkBatching"

describe("server network batching", () => {
  it("merges player deltas by entity id with later fields winning", () => {
    const merged = mergePlayerBatch([
      [{ id: 1, x: 10, y: 20, lastProcessedInputSeq: 1 }],
      [{ id: 1, x: 12, health: 80 }, { id: 2, x: 5 }],
    ])

    expect(merged).toEqual([
      { id: 1, x: 12, y: 20, lastProcessedInputSeq: 1, health: 80 },
      { id: 2, x: 5 },
    ])
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
})
