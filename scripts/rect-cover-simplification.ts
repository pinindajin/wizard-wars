/**
 * Utilities for exact half-open rectangle cover simplification.
 */

/** Axis-aligned half-open rectangle in world pixels. */
export type RectCover = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Returns the exact union of a rectangle cover as fewer disjoint rectangles.
 *
 * The algorithm partitions the input by all unique x/y edges, marks occupied
 * cells, then merges identical horizontal runs vertically. It preserves
 * half-open coverage exactly: `[x, x + width) x [y, y + height)`.
 *
 * @param rects - Input rectangles; non-positive rectangles are ignored.
 * @returns Deterministic disjoint rectangles with identical covered area.
 */
export function simplifyRectCover(rects: readonly RectCover[]): RectCover[] {
  const valid = rects.filter(isPositiveRect)
  if (valid.length === 0) return []

  const xs = sortedUniqueEdges(valid, "x", "width")
  const ys = sortedUniqueEdges(valid, "y", "height")

  const xIndexByValue = edgeIndexByValue(xs)
  const yIndexByValue = edgeIndexByValue(ys)
  const cols = xs.length - 1
  const rows = ys.length - 1
  const occupied = new Uint8Array(cols * rows)

  for (const rect of valid) {
    const x0 = xIndexByValue.get(rect.x)!
    const x1 = xIndexByValue.get(rect.x + rect.width)!
    const y0 = yIndexByValue.get(rect.y)!
    const y1 = yIndexByValue.get(rect.y + rect.height)!
    for (let y = y0; y < y1; y++) {
      const rowOffset = y * cols
      for (let x = x0; x < x1; x++) {
        occupied[rowOffset + x] = 1
      }
    }
  }

  return mergeVerticalRuns(horizontalRunsFromOccupancy(occupied, xs, ys, cols, rows))
}

/**
 * Tests whether a half-open rectangle cover contains a point.
 *
 * @param rects - Rectangles to test.
 * @param x - World x coordinate.
 * @param y - World y coordinate.
 * @returns True when the point is inside at least one rectangle.
 */
export function rectCoverContainsPoint(
  rects: readonly RectCover[],
  x: number,
  y: number,
): boolean {
  return rects.some(
    (rect) =>
      x >= rect.x &&
      x < rect.x + rect.width &&
      y >= rect.y &&
      y < rect.y + rect.height,
  )
}

/**
 * Sums rectangle areas. Intended for disjoint simplified covers or parity tests.
 *
 * @param rects - Rectangles to measure.
 * @returns Sum of `width * height` for positive rectangles.
 */
export function rectCoverArea(rects: readonly RectCover[]): number {
  return rects.reduce((sum, rect) => sum + Math.max(0, rect.width) * Math.max(0, rect.height), 0)
}

/**
 * Checks whether a rectangle has positive finite dimensions.
 *
 * @param rect - Rectangle to test.
 * @returns True when all coordinates are finite and dimensions are positive.
 */
function isPositiveRect(rect: RectCover): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  )
}

/**
 * Builds sorted unique start/end edges for one rectangle axis.
 *
 * @param rects - Valid rectangles.
 * @param originKey - Rectangle origin key for the axis.
 * @param sizeKey - Rectangle size key for the axis.
 * @returns Sorted unique coordinate edges.
 */
function sortedUniqueEdges(
  rects: readonly RectCover[],
  originKey: "x" | "y",
  sizeKey: "width" | "height",
): number[] {
  const edges = new Set<number>()
  for (const rect of rects) {
    edges.add(rect[originKey])
    edges.add(rect[originKey] + rect[sizeKey])
  }
  return [...edges].sort((a, b) => a - b)
}

/**
 * Creates a lookup from coordinate edge to sorted edge index.
 *
 * @param edges - Sorted coordinate edges.
 * @returns Map from coordinate value to edge index.
 */
function edgeIndexByValue(edges: readonly number[]): ReadonlyMap<number, number> {
  return new Map(edges.map((edge, index) => [edge, index]))
}

/**
 * Converts occupied edge cells into horizontal half-open rectangle runs.
 *
 * @param occupied - Row-major occupied-cell flags.
 * @param xs - Sorted x edges.
 * @param ys - Sorted y edges.
 * @param cols - Number of x cells.
 * @param rows - Number of y cells.
 * @returns Horizontal row runs.
 */
function horizontalRunsFromOccupancy(
  occupied: Uint8Array,
  xs: readonly number[],
  ys: readonly number[],
  cols: number,
  rows: number,
): RectCover[] {
  const runs: RectCover[] = []
  for (let y = 0; y < rows; y++) {
    let x = 0
    while (x < cols) {
      if (occupied[y * cols + x] === 0) {
        x++
        continue
      }
      const start = x
      while (x < cols && occupied[y * cols + x] === 1) x++
      runs.push({
        x: xs[start]!,
        y: ys[y]!,
        width: xs[x]! - xs[start]!,
        height: ys[y + 1]! - ys[y]!,
      })
    }
  }
  return runs
}

/**
 * Merges vertically adjacent runs with identical x/width.
 *
 * @param runs - Horizontal runs from occupied cells.
 * @returns Stable sorted merged rectangles.
 */
function mergeVerticalRuns(runs: readonly RectCover[]): RectCover[] {
  const sorted = [...runs]
    .sort((a, b) => a.height - b.height)
    .sort((a, b) => a.y - b.y)
    .sort((a, b) => a.width - b.width)
    .sort((a, b) => a.x - b.x)
  const merged: Array<{ x: number; y: number; width: number; height: number }> = []
  for (const rect of sorted) {
    const last = merged[merged.length - 1]
    if (last && last.x === rect.x && last.width === rect.width && last.y + last.height === rect.y) {
      last.height += rect.height
    } else {
      merged.push({ ...rect })
    }
  }
  return merged
    .sort((a, b) => a.height - b.height)
    .sort((a, b) => a.width - b.width)
    .sort((a, b) => a.x - b.x)
    .sort((a, b) => a.y - b.y)
}
