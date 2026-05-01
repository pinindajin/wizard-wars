/**
 * Builds fireball sprite sheets from the source pixel-art JPG.
 *
 * Source (not committed): a pixel-art sheet — default path points at the user's
 * local `my-sprites` vault; override with `--src=<path>` or `FIREBALL_SRC`.
 * The default source is 1168x784, laid out as 4 cols x 2 rows = 8 frames
 * at 292x392 px each (frame 1 top-left, frame 8 bottom-right).
 *
 * Outputs (committed):
 *  - `public/assets/sprites/abilities/fireball-channel.png`
 *      8 frames in a horizontal strip, black background keyed to transparent.
 *  - `public/assets/sprites/abilities/fireball-fly.png`
 *      8 variations synthesized from source frame 8: small rotations,
 *      ±5% pulse scale, and deterministic per-frame pixel tweaks so the
 *      animation reads as alive rather than a pure rotate/scale loop.
 *  - `public/assets/sprites/abilities/ember.png`
 *      A tiny ember particle used by the projectile trail emitter.
 */

import { existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

import sharp from "sharp"

const DEFAULT_SRC =
  "/Users/jakemcbride/Personal/Development/my-sprites/pixellab/fantasy/Abilities/fireball_anim.jpg"

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((arg) => {
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    return m ? [[m[1], m[2]]] : []
  }),
)

const SRC_PATH = args["src"] ?? process.env.FIREBALL_SRC ?? DEFAULT_SRC
const COLS = Number(args["cols"] ?? 4)
const ROWS = Number(args["rows"] ?? 2)
const FRAME_COUNT = COLS * ROWS

const OUT_DIR = resolve(process.cwd(), "public/assets/sprites/abilities")
const CHANNEL_OUT = resolve(OUT_DIR, "fireball-channel.png")
const FLY_OUT = resolve(OUT_DIR, "fireball-fly.png")
const EMBER_OUT = resolve(OUT_DIR, "ember.png")

/** Pulse envelope for the 8 fly frames (1.00 = baseline, ±5% swing). */
const FLY_PULSE = [1.0, 1.02, 1.05, 1.03, 1.0, 0.97, 0.95, 0.98]
/** Per-frame rotation (deg) for the fly strip so the fireball spins subtly. */
const FLY_ROT_DEG = [0, 10, 22, 30, 35, 25, 12, 4]

/**
 * Alpha-keys a dark background to full transparency. Treats any pixel whose
 * maximum RGB channel is below `threshold` as background. Also drops near-white
 * pixels (which in the source are decorative number labels baked into the art)
 * to keep the channel strip readable as flame frames only.
 *
 * @param raw - RGBA pixel buffer (row-major, 4 bytes per pixel).
 * @param threshold - Max-channel threshold below which pixels become transparent.
 * @returns The mutated buffer (same reference, for ergonomics).
 */
function keyBlackToAlpha(raw: Buffer, threshold = 60): Buffer {
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i]!
    const g = raw[i + 1]!
    const b = raw[i + 2]!
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const isNearWhite = r > 220 && g > 220 && b > 220 && max - min < 30
    if (max < threshold || isNearWhite) {
      raw[i + 3] = 0
    } else if (max < threshold * 1.5) {
      raw[i + 3] = Math.round(((max - threshold) / (threshold * 0.5)) * 255)
    }
  }
  return raw
}

/**
 * Finds the tight non-transparent bounding box of an RGBA buffer.
 *
 * @returns `{ left, top, width, height }` of the content; falls back to full image when empty.
 */
function contentBBox(
  raw: Buffer,
  width: number,
  height: number,
  alphaCutoff = 16,
): { left: number; top: number; width: number; height: number } {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = raw[(y * width + x) * 4 + 3]!
      if (a > alphaCutoff) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { left: 0, top: 0, width, height }
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

/**
 * Deterministic tiny per-frame pixel perturbations so the 8 fly frames don't
 * look like a pure rotate/scale loop. Shifts a few ember-colored pixels by
 * 1-2 pixels and nudges brightness — changes are baked into the sheet, not
 * applied at runtime.
 *
 * @param raw - RGBA pixel buffer for a single fly frame.
 * @param width - Frame width in pixels.
 * @param height - Frame height in pixels.
 * @param seed - Deterministic seed (frame index) so output is reproducible.
 */
function perturbEmbers(raw: Buffer, width: number, height: number, seed: number): void {
  const rng = mulberry32(seed * 2654435761)
  const edits = 24
  for (let n = 0; n < edits; n++) {
    const x = Math.floor(rng() * width)
    const y = Math.floor(rng() * height)
    const i = (y * width + x) * 4
    const a = raw[i + 3]!
    if (a < 64) continue
    const r = raw[i]!
    const g = raw[i + 1]!
    const b = raw[i + 2]!
    if (r < 160 || g < 60) continue
    const delta = Math.floor((rng() - 0.5) * 80)
    raw[i] = clamp(r + delta)
    raw[i + 1] = clamp(g + Math.floor(delta * 0.5))
    raw[i + 2] = clamp(b + Math.floor(delta * 0.25))
  }
}

function mulberry32(a: number): () => number {
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/**
 * Extracts a single frame from the source sheet as a keyed-transparent RGBA
 * buffer with its width/height metadata.
 */
async function extractFrame(
  srcPath: string,
  frameW: number,
  frameH: number,
  col: number,
  row: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(srcPath)
    .extract({ left: col * frameW, top: row * frameH, width: frameW, height: frameH })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  keyBlackToAlpha(data)
  return { buffer: data, width: info.width, height: info.height }
}

/** Output cell size for both strips. Square cells render evenly in Phaser. */
const OUT_CELL = 256

async function buildChannelStrip(
  srcPath: string,
  frameW: number,
  frameH: number,
): Promise<void> {
  const composites: sharp.OverlayOptions[] = []
  for (let i = 0; i < FRAME_COUNT; i++) {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const frame = await extractFrame(srcPath, frameW, frameH, col, row)
    const bbox = contentBBox(frame.buffer, frame.width, frame.height)

    const cropped = await sharp(frame.buffer, {
      raw: { width: frame.width, height: frame.height, channels: 4 },
    })
      .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
      .resize(OUT_CELL, OUT_CELL, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer()

    composites.push({ input: cropped, left: i * OUT_CELL, top: 0 })
  }
  await sharp({
    create: {
      width: OUT_CELL * FRAME_COUNT,
      height: OUT_CELL,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toFile(CHANNEL_OUT)
  console.log(`wrote ${CHANNEL_OUT} (${FRAME_COUNT} frames, ${OUT_CELL}x${OUT_CELL} each)`)
}

async function buildFlyStrip(
  srcPath: string,
  frameW: number,
  frameH: number,
): Promise<void> {
  // Final source frame (bottom-right cell) is the largest explosion and reads
  // best as a flying projectile after we square-crop and clean it up.
  const lastCol = (FRAME_COUNT - 1) % COLS
  const lastRow = Math.floor((FRAME_COUNT - 1) / COLS)
  const raw = await extractFrame(srcPath, frameW, frameH, lastCol, lastRow)
  const bbox = contentBBox(raw.buffer, raw.width, raw.height)

  const baseSquare = await sharp(raw.buffer, {
    raw: { width: raw.width, height: raw.height, channels: 4 },
  })
    .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
    .resize(OUT_CELL, OUT_CELL, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true })

  // The source explosion has a baked-in underline + frame-number artifact above
  // and below; mask anything outside a generous circular hull centered on the
  // cell so the fly frames read as a clean round projectile.
  {
    const w = baseSquare.info.width
    const h = baseSquare.info.height
    const cx = (w - 1) / 2
    const cy = (h - 1) / 2
    const radius = Math.min(w, h) * 0.42
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.hypot(x - cx, y - cy) > radius) {
          baseSquare.data[(y * w + x) * 4 + 3] = 0
        }
      }
    }
  }

  const composites: sharp.OverlayOptions[] = []
  for (let i = 0; i < FRAME_COUNT; i++) {
    const pulse = FLY_PULSE[i]!
    const rot = FLY_ROT_DEG[i]!
    const pulseSize = Math.max(2, Math.round(OUT_CELL * pulse))

    const rotated = await sharp(baseSquare.data, {
      raw: { width: baseSquare.info.width, height: baseSquare.info.height, channels: 4 },
    })
      .resize(pulseSize, pulseSize, { fit: "fill" })
      .rotate(rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize(OUT_CELL, OUT_CELL, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .raw()
      .toBuffer({ resolveWithObject: true })

    perturbEmbers(rotated.data, rotated.info.width, rotated.info.height, i + 1)

    const pngBuf = await sharp(rotated.data, {
      raw: { width: rotated.info.width, height: rotated.info.height, channels: 4 },
    })
      .png()
      .toBuffer()

    composites.push({ input: pngBuf, left: i * OUT_CELL, top: 0 })
  }

  await sharp({
    create: {
      width: OUT_CELL * FRAME_COUNT,
      height: OUT_CELL,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toFile(FLY_OUT)
  console.log(`wrote ${FLY_OUT} (${FRAME_COUNT} fly frames, ${OUT_CELL}x${OUT_CELL} each)`)
  void frameW
  void frameH
}

async function buildEmber(): Promise<void> {
  const size = 8
  const raw = Buffer.alloc(size * size * 4, 0)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (size - 1) / 2
      const cy = (size - 1) / 2
      const d = Math.hypot(x - cx, y - cy)
      const falloff = Math.max(0, 1 - d / (size / 2))
      const a = Math.round(255 * falloff)
      const i = (y * size + x) * 4
      raw[i] = 255
      raw[i + 1] = Math.round(180 * falloff + 40 * (1 - falloff))
      raw[i + 2] = Math.round(60 * falloff)
      raw[i + 3] = a
    }
  }
  await sharp(raw, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toFile(EMBER_OUT)
  console.log(`wrote ${EMBER_OUT} (${size}x${size} radial ember)`)
}

async function main(): Promise<void> {
  if (!existsSync(SRC_PATH)) {
    console.error(
      `Source sheet not found: ${SRC_PATH}\n` +
        `Pass --src=<path> or set FIREBALL_SRC. Committed PNGs under\n` +
        `public/assets/sprites/abilities/ are the source of truth for CI.`,
    )
    process.exit(1)
  }

  mkdirSync(dirname(CHANNEL_OUT), { recursive: true })

  const meta = await sharp(SRC_PATH).metadata()
  if (!meta.width || !meta.height) throw new Error("bad source metadata")
  if (meta.width % COLS !== 0 || meta.height % ROWS !== 0) {
    throw new Error(
      `source ${meta.width}x${meta.height} not divisible by ${COLS}x${ROWS} — ` +
        `pass --cols=/--rows= explicitly`,
    )
  }
  const frameW = meta.width / COLS
  const frameH = meta.height / ROWS

  await buildChannelStrip(SRC_PATH, frameW, frameH)
  await buildFlyStrip(SRC_PATH, frameW, frameH)
  await buildEmber()
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
