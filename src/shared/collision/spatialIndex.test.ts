import { describe, expect, it } from "vitest"

import {
  createSpatialQueryScratch,
  createStaticAabbIndex,
  queryAabbIds,
  queryPointIds,
  type Aabb,
} from "./spatialIndex"

describe("spatialIndex", () => {
  it("rejects invalid cell sizes", () => {
    expect(() => createStaticAabbIndex([], { cellSizePx: 0 })).toThrow(
      "cellSizePx must be a positive finite number",
    )
    expect(() => createStaticAabbIndex([], { cellSizePx: Number.POSITIVE_INFINITY })).toThrow(
      "cellSizePx must be a positive finite number",
    )
  })

  it("returns AABB candidates in original source order and dedupes multi-cell items", () => {
    const items: Aabb[] = [
      { x: 192, y: 0, width: 16, height: 16 },
      { x: 0, y: 0, width: 128, height: 64 },
      { x: 64, y: 0, width: 32, height: 32 },
    ]
    const index = createStaticAabbIndex(items, { cellSizePx: 64 })
    const scratch = createSpatialQueryScratch()

    const ids = queryAabbIds(index, { x: 63, y: 1, width: 2, height: 2 }, scratch)

    expect(ids).toEqual([1, 2])
  })

  it("uses half-open point containment", () => {
    const items: Aabb[] = [{ x: 10, y: 10, width: 54, height: 54 }]
    const index = createStaticAabbIndex(items, { cellSizePx: 64 })

    expect(queryPointIds(index, 63, 63)).toEqual([0])
    expect(queryPointIds(index, 64, 64)).toEqual([])
  })

  it("indexes negative and out-of-arena coordinates safely", () => {
    const items: Aabb[] = [
      { x: -32, y: -32, width: 16, height: 16 },
      { x: 4096, y: 4096, width: 128, height: 128 },
    ]
    const index = createStaticAabbIndex(items, { cellSizePx: 64 })

    expect(queryPointIds(index, -24, -24)).toEqual([0])
    expect(queryAabbIds(index, { x: 4160, y: 4160, width: 1, height: 1 })).toEqual([1])
  })

  it("returns no false negatives for AABB queries compared with brute force overlap", () => {
    const items: Aabb[] = [
      { x: 0, y: 0, width: 32, height: 32 },
      { x: 128, y: 128, width: 64, height: 64 },
      { x: 256, y: 32, width: 96, height: 128 },
    ]
    const index = createStaticAabbIndex(items, { cellSizePx: 64 })
    const query = { x: 160, y: 96, width: 160, height: 96 }

    const bruteForceIds = items
      .map((item, id) => ({ item, id }))
      .filter(({ item }) =>
        item.x <= query.x + query.width &&
        item.x + item.width >= query.x &&
        item.y <= query.y + query.height &&
        item.y + item.height >= query.y,
      )
      .map(({ id }) => id)

    expect(queryAabbIds(index, query)).toEqual(bruteForceIds)
  })
})
