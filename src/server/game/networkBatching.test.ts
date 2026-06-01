import { describe, expect, it } from "vitest"

import { mergeFireballBatch, mergePlayerBatch } from "./networkBatching"

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
})
