/**
 * Builds per-clip horizontal strip PNGs and atlas.json for a configured hero sprite.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import sharp from "sharp"

import {
  HERO_SPRITE_CONFIGS,
  HERO_SPRITE_DIRECTIONS,
  normalizeHeroSpriteId,
  type HeroSpriteDirection,
} from "../src/shared/sprites/heroSprites"

/**
 * Returns sorted PNG frame paths from a directory.
 *
 * @param dirPath - Directory containing frame PNGs.
 * @returns Sorted absolute paths.
 */
function getFramePaths(dirPath: string): string[] {
  return readdirSync(dirPath)
    .filter((entry) => entry.toLowerCase().endsWith(".png"))
    .sort()
    .map((entry) => join(dirPath, entry))
}

/**
 * Builds one horizontal strip PNG.
 *
 * @param frameSize - Runtime frame size.
 * @param outputPath - Destination strip PNG path.
 * @param frames - Frame PNG paths.
 */
async function buildStrip(frameSize: number, outputPath: string, frames: readonly string[]): Promise<void> {
  if (frames.length === 0) {
    throw new Error(`Cannot build strip with no frames: ${outputPath}`)
  }

  const canvas = sharp({
    create: {
      width: frameSize * frames.length,
      height: frameSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })

  await canvas
    .composite(frames.map((framePath, i) => ({ input: framePath, left: i * frameSize, top: 0 })))
    .png()
    .toFile(outputPath)
}

export type BuildHeroSheetsResult = {
  readonly atlasPath: string
  readonly sheetCount: number
}

/**
 * Builds committed strip sheets and atlas.json for a hero.
 *
 * @param heroId - Hero id to build.
 * @param cwd - Repository working directory.
 * @returns Build result.
 */
export async function buildHeroSheets(
  heroId: string,
  cwd: string = process.cwd(),
): Promise<BuildHeroSheetsResult> {
  const hero = HERO_SPRITE_CONFIGS[normalizeHeroSpriteId(heroId)]
  const heroRoot = resolve(cwd, hero.publicHeroDir)
  const animationsDir = join(heroRoot, "animations")
  const outputDir = join(heroRoot, "sheets")
  mkdirSync(outputDir, { recursive: true })

  const atlas: Record<string, Record<HeroSpriteDirection, number>> = {}
  let sheetCount = 0

  for (const clipId of hero.clipOrder) {
    const clip = hero.clips[clipId]
    atlas[clip.atlasClipId] = {} as Record<HeroSpriteDirection, number>

    for (const direction of HERO_SPRITE_DIRECTIONS) {
      const framesDir = join(animationsDir, clip.atlasClipId, direction)
      if (!existsSync(framesDir)) {
        throw new Error(`Missing frame directory: ${framesDir}`)
      }
      const frames = getFramePaths(framesDir)
      if (frames.length !== clip.frameCount) {
        throw new Error(
          `Expected ${clip.frameCount} frames for ${hero.id}/${clip.atlasClipId}/${direction}, got ${frames.length}`,
        )
      }
      await buildStrip(
        hero.frameSizePx,
        join(outputDir, `${clip.sheetPrefix}-${direction}.png`),
        frames,
      )
      atlas[clip.atlasClipId]![direction] = frames.length
      sheetCount += 1
    }
  }

  const atlasPath = join(outputDir, "atlas.json")
  writeFileSync(atlasPath, JSON.stringify({ frameSize: hero.frameSizePx, clips: atlas }, null, 2))

  return { atlasPath, sheetCount }
}

const isCliEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /build-hero-sheets\.(ts|js|mjs|cjs)$/.test(process.argv[1])

if (isCliEntry) {
  void buildHeroSheets(process.argv[2] ?? "yen").catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
