export type Aabb = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type StaticAabbIndex<T extends Aabb> = {
  readonly items: readonly T[]
  readonly cellSizePx: number
  readonly cells: ReadonlyMap<string, readonly number[]>
}

export type SpatialQueryScratch = {
  readonly seen: Set<number>
  readonly ids: number[]
}

export function createSpatialQueryScratch(): SpatialQueryScratch {
  return {
    seen: new Set<number>(),
    ids: [],
  }
}

export function createStaticAabbIndex<T extends Aabb>(
  items: readonly T[],
  options: { readonly cellSizePx: number },
): StaticAabbIndex<T> {
  const { cellSizePx } = options
  if (cellSizePx <= 0 || !Number.isFinite(cellSizePx)) {
    throw new Error("cellSizePx must be a positive finite number")
  }

  const mutableCells = new Map<string, number[]>()
  items.forEach((item, id) => {
    forEachCell(item, cellSizePx, (cellX, cellY) => {
      const key = cellKey(cellX, cellY)
      const bucket = mutableCells.get(key)
      if (bucket) {
        bucket.push(id)
      } else {
        mutableCells.set(key, [id])
      }
    })
  })

  return { items, cellSizePx, cells: mutableCells }
}

export function queryAabbIds<T extends Aabb>(
  index: StaticAabbIndex<T>,
  aabb: Aabb,
  scratch = createSpatialQueryScratch(),
): readonly number[] {
  resetScratch(scratch)
  collectCellIds(index, aabb, scratch)
  scratch.ids.sort((a, b) => a - b)
  return scratch.ids.filter((id) => aabbsOverlapInclusive(index.items[id]!, aabb))
}

export function queryPointIds<T extends Aabb>(
  index: StaticAabbIndex<T>,
  x: number,
  y: number,
  scratch = createSpatialQueryScratch(),
): readonly number[] {
  resetScratch(scratch)
  const bucket = index.cells.get(cellKey(cellCoord(x, index.cellSizePx), cellCoord(y, index.cellSizePx)))
  if (!bucket) return scratch.ids
  for (const id of bucket) {
    const item = index.items[id]!
    if (pointInAabb(x, y, item)) scratch.ids.push(id)
  }
  scratch.ids.sort((a, b) => a - b)
  return scratch.ids
}

function resetScratch(scratch: SpatialQueryScratch): void {
  scratch.seen.clear()
  scratch.ids.length = 0
}

function collectCellIds<T extends Aabb>(
  index: StaticAabbIndex<T>,
  aabb: Aabb,
  scratch: SpatialQueryScratch,
): void {
  forEachCell(aabb, index.cellSizePx, (cellX, cellY) => {
    const bucket = index.cells.get(cellKey(cellX, cellY))
    if (!bucket) return
    for (const id of bucket) {
      if (scratch.seen.has(id)) continue
      scratch.seen.add(id)
      scratch.ids.push(id)
    }
  })
}

function forEachCell(
  aabb: Aabb,
  cellSizePx: number,
  visit: (cellX: number, cellY: number) => void,
): void {
  const minX = cellCoord(aabb.x, cellSizePx)
  const minY = cellCoord(aabb.y, cellSizePx)
  const maxX = cellCoord(aabb.x + Math.max(0, aabb.width), cellSizePx)
  const maxY = cellCoord(aabb.y + Math.max(0, aabb.height), cellSizePx)
  for (let cellY = minY; cellY <= maxY; cellY++) {
    for (let cellX = minX; cellX <= maxX; cellX++) {
      visit(cellX, cellY)
    }
  }
}

function cellCoord(value: number, cellSizePx: number): number {
  return Math.floor(value / cellSizePx)
}

function cellKey(cellX: number, cellY: number): string {
  return `${cellX},${cellY}`
}

function pointInAabb(x: number, y: number, aabb: Aabb): boolean {
  return (
    x >= aabb.x &&
    x < aabb.x + aabb.width &&
    y >= aabb.y &&
    y < aabb.y + aabb.height
  )
}

function aabbsOverlapInclusive(a: Aabb, b: Aabb): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  )
}
