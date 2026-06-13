/**
 * Builds the committed Homing Orb fly sprite sheet from the committed Fireball fly sheet.
 *
 * Output:
 *  - `public/assets/sprites/abilities/homing-orb-fly.png`
 *      5 east-facing frames in a horizontal strip. Each source Fireball frame is
 *      cropped to visible alpha, scaled to 60%, purple-shifted, and centered
 *      inside a transparent 256x256 Phaser cell.
 */

import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import sharp from "sharp"

export const HOMING_ORB_FLY_FRAME_SIZE_PX = 256
export const HOMING_ORB_FLY_FRAME_COUNT = 5
export const HOMING_ORB_VISIBLE_SCALE = 0.6

const OUT_DIR = resolve(process.cwd(), "public/assets/sprites/abilities")
const DEFAULT_SOURCE = resolve(OUT_DIR, "fireball-fly.png")
const DEFAULT_OUT = resolve(OUT_DIR, "homing-orb-fly.png")

type Bounds = { left: number; top: number; width: number; height: number }

export type BuildHomingOrbFlySheetResult = {
  outPath: string
  frameCount: number
  frameSize: number
  width: number
  height: number
}

type BuildHomingOrbFlySheetOptions = {
  sourcePath?: string
  outPath?: string
  frameSize?: number
  frameCount?: number
  log?: (message: string) => void
}

/**
 * Finds the tight non-transparent bounding box of an RGBA buffer.
 *
 * @param raw - RGBA pixel buffer.
 * @param width - Buffer width in pixels.
 * @param height - Buffer height in pixels.
 * @returns Visible alpha bounds, or `null` if the frame is fully transparent.
 */
function alphaBounds(raw: Buffer, width: number, height: number): Bounds | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = raw[(y * width + x) * 4 + 3]!
      if (alpha === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) return null
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

/**
 * Purple-shifts an RGBA sprite buffer in place.
 *
 * @param raw - Mutable RGBA pixel buffer.
 * @returns The same buffer after color adjustment.
 */
function purpleShift(raw: Buffer): Buffer {
  for (let i = 0; i < raw.length; i += 4) {
    const alpha = raw[i + 3]!
    if (alpha === 0) continue
    const r = raw[i]!
    const g = raw[i + 1]!
    const b = raw[i + 2]!
    raw[i] = Math.min(255, Math.round(r * 0.75 + b * 0.35 + 42))
    raw[i + 1] = Math.min(255, Math.round(g * 0.35 + 18))
    raw[i + 2] = Math.min(255, Math.round(b * 1.35 + r * 0.45 + 70))
  }
  return raw
}

/**
 * Renders one source Fireball frame into a purple 256x256 Homing Orb frame cell.
 *
 * @param sourceSheet - Sharp instance for the source sheet.
 * @param index - Zero-based source frame index.
 * @param frameSize - Square frame cell size in pixels.
 * @returns PNG bytes for one Homing Orb frame cell.
 */
async function renderHomingOrbFrameCell(
  sourceSheet: sharp.Sharp,
  index: number,
  frameSize: number,
): Promise<Buffer> {
  const left = index * frameSize
  const { data, info } = await sourceSheet
    .clone()
    .extract({ left, top: 0, width: frameSize, height: frameSize })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const bounds = alphaBounds(data, info.width, info.height)
  if (!bounds) {
    throw new Error(`Homing Orb source frame ${String(index)} has no visible pixels`)
  }

  const scaledWidth = Math.max(1, Math.round(bounds.width * HOMING_ORB_VISIBLE_SCALE))
  const scaledHeight = Math.max(1, Math.round(bounds.height * HOMING_ORB_VISIBLE_SCALE))
  const resized = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .extract(bounds)
    .resize(scaledWidth, scaledHeight, {
      fit: "fill",
      kernel: "nearest",
    })
    .ensureAlpha()
    .raw()
    .toBuffer()
  const shifted = purpleShift(Buffer.from(resized))
  const cell = await sharp({
    create: {
      width: frameSize,
      height: frameSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp(shifted, {
          raw: { width: scaledWidth, height: scaledHeight, channels: 4 },
        }).png({ compressionLevel: 9 }).toBuffer(),
        left: Math.floor((frameSize - scaledWidth) / 2),
        top: Math.floor((frameSize - scaledHeight) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer()
  return cell
}

/**
 * Builds the Homing Orb fly sprite sheet from the committed Fireball fly sheet.
 *
 * @param options - Build paths and output settings.
 * @returns Output metadata for tests and CLI logging.
 */
export async function buildHomingOrbFlySheet(
  options: BuildHomingOrbFlySheetOptions = {},
): Promise<BuildHomingOrbFlySheetResult> {
  const sourcePath = options.sourcePath ?? DEFAULT_SOURCE
  const outPath = options.outPath ?? DEFAULT_OUT
  const frameSize = options.frameSize ?? HOMING_ORB_FLY_FRAME_SIZE_PX
  const frameCount = options.frameCount ?? HOMING_ORB_FLY_FRAME_COUNT
  const log = options.log ?? console.log
  const sourceSheet = sharp(sourcePath)

  await mkdir(dirname(outPath), { recursive: true })

  const composites: sharp.OverlayOptions[] = []
  for (let index = 0; index < frameCount; index++) {
    composites.push({
      input: await renderHomingOrbFrameCell(sourceSheet, index, frameSize),
      left: index * frameSize,
      top: 0,
    })
  }

  const width = frameSize * frameCount
  const height = frameSize
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outPath)

  log(`wrote ${outPath} (${String(frameCount)} fly frames, ${String(frameSize)}x${String(frameSize)} each)`)
  return {
    outPath,
    frameCount,
    frameSize,
    width,
    height,
  }
}

/**
 * Parses `--key=value` CLI arguments into a small option map.
 *
 * @param argv - CLI argument list without node/script entries.
 * @returns Parsed key/value arguments.
 */
function parseArgs(argv: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    argv.flatMap((arg) => {
      const match = /^--([^=]+)=(.*)$/.exec(arg)
      return match ? [[match[1]!, match[2]!]] : []
    }),
  )
}

/**
 * Returns true when this module is executing as the CLI entrypoint.
 *
 * @param argv - Process argument vector.
 * @returns Whether `argv[1]` points at this module.
 */
function isCliEntrypoint(argv: readonly string[]): boolean {
  const scriptPath = argv[1]
  return Boolean(scriptPath && pathToFileURL(resolve(scriptPath)).href === import.meta.url)
}

/**
 * Runs the Homing Orb fly sheet builder from CLI arguments.
 *
 * @returns Resolves after the output sheet is written.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  await buildHomingOrbFlySheet({
    sourcePath: args.source ?? args["source-path"],
    outPath: args.out,
  })
}

if (isCliEntrypoint(process.argv)) {
  void main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
