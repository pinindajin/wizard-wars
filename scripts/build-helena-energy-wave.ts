/** Builds Helena's eight-frame cosmetic energy-wave spritesheet. */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import sharp from "sharp"

export const HELENA_ENERGY_WAVE_FRAME_SIZE = 128
export const HELENA_ENERGY_WAVE_FRAME_COUNT = 8

const framesDir = resolve(
  process.cwd(),
  "public/assets/sprites/effects/helena-energy-wave/frames",
)
const outputPath = resolve(
  process.cwd(),
  "public/assets/sprites/effects/helena-energy-wave.png",
)

async function prepareFrames(sourcePath: string): Promise<void> {
  if (!existsSync(sourcePath)) throw new Error(`Wave source not found: ${sourcePath}`)
  rmSync(framesDir, { recursive: true, force: true })
  mkdirSync(framesDir, { recursive: true })

  const trimmed = await sharp(sourcePath).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  const heights = [54, 66, 78, 88, 94, 90, 82, 70]
  for (let index = 0; index < HELENA_ENERGY_WAVE_FRAME_COUNT; index++) {
    const height = heights[index]!
    const sprite = await sharp(trimmed)
      .resize({ height, width: height, fit: "inside", kernel: "nearest" })
      .png()
      .toBuffer()
    const metadata = await sharp(sprite).metadata()
    const width = metadata.width ?? 0
    const renderedHeight = metadata.height ?? 0
    await sharp({
      create: {
        width: HELENA_ENERGY_WAVE_FRAME_SIZE,
        height: HELENA_ENERGY_WAVE_FRAME_SIZE,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{
        input: sprite,
        left: Math.round((HELENA_ENERGY_WAVE_FRAME_SIZE - width) / 2),
        top: Math.round((HELENA_ENERGY_WAVE_FRAME_SIZE - renderedHeight) / 2),
      }])
      .png()
      .toFile(join(framesDir, `frame_${String(index).padStart(3, "0")}.png`))
  }
}

export async function buildHelenaEnergyWave(sourcePath?: string): Promise<void> {
  if (sourcePath) await prepareFrames(resolve(sourcePath))
  const frames = readdirSync(framesDir)
    .filter((entry) => entry.toLowerCase().endsWith(".png"))
    .sort()
    .map((entry) => join(framesDir, entry))
  if (frames.length !== HELENA_ENERGY_WAVE_FRAME_COUNT) {
    throw new Error(`Expected ${HELENA_ENERGY_WAVE_FRAME_COUNT} wave frames, got ${frames.length}`)
  }

  for (const frame of frames) {
    const metadata = await sharp(frame).metadata()
    if (
      metadata.width !== HELENA_ENERGY_WAVE_FRAME_SIZE ||
      metadata.height !== HELENA_ENERGY_WAVE_FRAME_SIZE ||
      metadata.hasAlpha !== true
    ) {
      throw new Error(`Invalid wave frame: ${frame}`)
    }
    const { data, info } = await sharp(frame).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const cornerAlphaOffsets = [
      3,
      (info.width - 1) * info.channels + 3,
      (info.height - 1) * info.width * info.channels + 3,
      (info.width * info.height - 1) * info.channels + 3,
    ]
    if (cornerAlphaOffsets.some((offset) => data[offset] !== 0)) {
      throw new Error(`Wave frame corners must be transparent: ${frame}`)
    }
  }

  mkdirSync(resolve(outputPath, ".."), { recursive: true })
  await sharp({
    create: {
      width: HELENA_ENERGY_WAVE_FRAME_SIZE * HELENA_ENERGY_WAVE_FRAME_COUNT,
      height: HELENA_ENERGY_WAVE_FRAME_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(frames.map((frame, index) => ({
      input: frame,
      left: index * HELENA_ENERGY_WAVE_FRAME_SIZE,
      top: 0,
    })))
    .png()
    .toFile(outputPath)
}

if (/build-helena-energy-wave\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? "")) {
  void buildHelenaEnergyWave(process.argv[2]).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
