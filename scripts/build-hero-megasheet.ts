/**
 * Builds a Phaser spritesheet megasheet for a configured hero sprite.
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import sharp from "sharp"

import {
  HERO_SPRITE_CONFIGS,
  HERO_SPRITE_DIRECTIONS,
  normalizeHeroSpriteId,
} from "../src/shared/sprites/heroSprites"

/**
 * Creates a transparent horizontal strip for an empty megasheet slot.
 *
 * @param frameSize - Runtime frame size.
 * @param slotFrames - Number of frames in the slot.
 * @returns PNG buffer.
 */
async function makeTransparentStrip(frameSize: number, slotFrames: number): Promise<Buffer> {
  return sharp({
    create: {
      width: slotFrames * frameSize,
      height: frameSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer()
}

export type BuildHeroMegasheetOptions = {
  readonly heroId?: string
  readonly sheetsDir?: string
  readonly silent?: boolean
}

export type BuildHeroMegasheetResult = {
  readonly outputPath: string
  readonly width: number
  readonly height: number
  readonly framesPerRow: number
}

/**
 * Composites a hero megasheet from per-clip, per-direction strip PNGs.
 *
 * @param options - Build options.
 * @returns Output metadata.
 */
export async function buildHeroMegasheet(
  options: BuildHeroMegasheetOptions = {},
): Promise<BuildHeroMegasheetResult> {
  const hero = HERO_SPRITE_CONFIGS[normalizeHeroSpriteId(options.heroId ?? "yen")]
  const sheetsDir = options.sheetsDir ?? resolve(process.cwd(), hero.publicHeroDir, "sheets")
  const output = join(sheetsDir, `${hero.spriteKey}-megasheet.png`)
  const log = options.silent ? () => {} : console.log
  const warn = options.silent ? () => {} : console.warn

  const frameSize = hero.frameSizePx
  const width = hero.framesPerDirectionRow * frameSize
  const height = HERO_SPRITE_DIRECTIONS.length * frameSize
  const layers: { input: Buffer; left: number; top: number }[] = []

  for (let row = 0; row < HERO_SPRITE_DIRECTIONS.length; row++) {
    const direction = HERO_SPRITE_DIRECTIONS[row]!
    const y = row * frameSize

    for (const clipId of hero.clipOrder) {
      const clip = hero.clips[clipId]
      const slotW = clip.frameCount * frameSize
      const x = hero.clipBaseFrame[clipId] * frameSize
      const filePath = join(sheetsDir, `${clip.sheetPrefix}-${direction}.png`)

      let input: Buffer
      if (existsSync(filePath)) {
        const raw = await sharp(filePath).png().toBuffer()
        const meta = await sharp(raw).metadata()
        if (meta.width === undefined || meta.height === undefined) {
          throw new Error(`No size for ${filePath}`)
        }
        if (meta.height !== frameSize) {
          throw new Error(`Expected height ${frameSize} for ${filePath}, got ${meta.height}`)
        }
        if (meta.width > slotW) {
          throw new Error(`Strip too wide for slot (${String(clipId)} ${direction}): ${meta.width} > ${slotW}`)
        }
        if (meta.width === slotW) {
          input = raw
        } else {
          const pad = await makeTransparentStrip(frameSize, clip.frameCount)
          input = await sharp(pad)
            .composite([{ input: raw, left: 0, top: 0 }])
            .png()
            .toBuffer()
        }
      } else {
        input = await makeTransparentStrip(frameSize, clip.frameCount)
        warn(`Missing ${filePath}; using transparent ${clip.frameCount} frame slot`)
      }

      layers.push({ input, left: x, top: y })
    }
  }

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png()
    .toFile(output)

  log(`Wrote ${output} (${width}x${height}, ${hero.framesPerDirectionRow} frames/row)`)

  return {
    outputPath: output,
    width,
    height,
    framesPerRow: hero.framesPerDirectionRow,
  }
}

const isCliEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /build-hero-megasheet\.(ts|js|mjs|cjs)$/.test(process.argv[1])

if (isCliEntry) {
  void buildHeroMegasheet({ heroId: process.argv[2] ?? "yen" }).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
