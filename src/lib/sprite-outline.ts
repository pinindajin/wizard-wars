/**
 * Pure helpers to derive alpha-mask outline segments from RGBA image data.
 * Used by the sprite viewer; outline results should be cached per frame client-side.
 */

export type AlphaOutlineSegment = {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * Reads RGBA alpha at integer pixel coordinates; out-of-bounds reads as transparent.
 *
 * @param data - RGBA bytes, length `width * height * 4`.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param x - Pixel column.
 * @param y - Pixel row.
 * @param alphaThreshold - Minimum inclusive alpha to count as opaque.
 * @returns Alpha value in 0–255, or 0 outside the image.
 */
function alphaAt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  alphaThreshold: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0
  const i = (y * width + x) * 4 + 3
  const a = data[i] ?? 0
  return a > alphaThreshold ? a : 0
}

/**
 * Returns true when the pixel is considered opaque.
 *
 * @param data - RGBA bytes.
 * @param width - Image width.
 * @param height - Image height.
 * @param x - Pixel column.
 * @param y - Pixel row.
 * @param alphaThreshold - Minimum inclusive alpha for opaque.
 * @returns Whether the sample counts as opaque.
 */
function isOpaque(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  alphaThreshold: number,
): boolean {
  return alphaAt(data, width, height, x, y, alphaThreshold) > 0
}

/**
 * Builds axis-aligned 1px segments on the boundary between opaque and transparent
 * pixels (4-neighbourhood). Coordinates are in **pixel corner** space where each
 * pixel occupies the square `[x, x+1] × [y, y+1]`.
 *
 * @param data - RGBA image bytes (`ImageData.data`).
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param alphaThreshold - Pixels with alpha `<=` this value are treated as transparent (default 8).
 * @returns List of segments suitable for `ctx.beginPath(); ctx.moveTo; ctx.lineTo` chains.
 */
export function computeAlphaOutlineSegments(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 8,
): AlphaOutlineSegment[] {
  const out: AlphaOutlineSegment[] = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isOpaque(data, width, height, x, y, alphaThreshold)) continue

      // Shared right edge with neighbour (x+1, y)
      if (!isOpaque(data, width, height, x + 1, y, alphaThreshold)) {
        out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 })
      }
      // Shared left edge with neighbour (x-1, y)
      if (!isOpaque(data, width, height, x - 1, y, alphaThreshold)) {
        out.push({ x1: x, y1: y, x2: x, y2: y + 1 })
      }
      // Shared bottom edge with (x, y+1)
      if (!isOpaque(data, width, height, x, y + 1, alphaThreshold)) {
        out.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 })
      }
      // Shared top edge with (x, y-1)
      if (!isOpaque(data, width, height, x, y - 1, alphaThreshold)) {
        out.push({ x1: x, y1: y, x2: x + 1, y2: y })
      }
    }
  }

  return out
}

/**
 * Strokes outline segments on a 2D canvas context (1px hairlines, no fill).
 *
 * @param ctx - Canvas rendering context.
 * @param segments - Segments from {@link computeAlphaOutlineSegments}.
 * @param offsetX - Horizontal offset applied to all coordinates.
 * @param offsetY - Vertical offset applied to all coordinates.
 */
export function strokeAlphaOutlineSegments(
  ctx: CanvasRenderingContext2D,
  segments: readonly AlphaOutlineSegment[],
  offsetX: number,
  offsetY: number,
): void {
  if (segments.length === 0) return
  ctx.beginPath()
  for (const s of segments) {
    ctx.moveTo(s.x1 + offsetX, s.y1 + offsetY)
    ctx.lineTo(s.x2 + offsetX, s.y2 + offsetY)
  }
  ctx.stroke()
}
