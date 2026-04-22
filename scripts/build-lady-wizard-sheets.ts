/**
 * Builds sprite sheets for the lady-wizard character from individual frame PNGs.
 * Generates one sheet per animation clip (all 8 directions in one horizontal strip per row).
 * Output: public/assets/sprites/heroes/lady-wizard/sheets/<clip>-<direction>.png
 * Also outputs a JSON atlas for Phaser's MultiAtlas loader.
 */

import { join, resolve } from "node:path"
import { readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import sharp from "sharp"

const SPRITE_DIR = resolve(process.cwd(), "public/assets/sprites/heroes/lady-wizard")
const OUTPUT_DIR = resolve(SPRITE_DIR, "sheets")
const FRAME_SIZE = 124 // px — from metadata.json

const DIRECTIONS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]

const ANIMATION_CLIPS = [
  "walk",
  "idle",
  "death",
  "light-spell-cast",
  "heavy-spell-cast",
  "summoned-axe-attack",
]

/** Direction variants with alternate names in the filesystem. */
const DIRECTION_ALIASES: Record<string, string[]> = {
  "south-west": ["south-west", "south-west-dfedd989", "south-west-ec40c380"],
  "north": ["north", "north-3cee9376", "north-dead8a56"],
  "idle": ["idle", "Breathing_Idle"],
}

/**
 * Finds the actual directory name for a given clip+direction combo, handling aliases.
 *
 * @param clipDir - Path to the animation clip directory.
 * @param direction - The canonical direction name.
 * @returns The resolved subdirectory path, or null if not found.
 */
function findDirectionDir(clipDir: string, direction: string): string | null {
  const aliases = DIRECTION_ALIASES[direction] ?? [direction]
  for (const alias of aliases) {
    const candidate = join(clipDir, alias)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Loads all frame PNG paths for a clip+direction in sorted order.
 *
 * @param dirPath - Path to the clip+direction directory.
 * @returns Sorted array of absolute PNG file paths.
 */
function getFramePaths(dirPath: string): string[] {
  return readdirSync(dirPath)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => join(dirPath, f))
}

/**
 * Builds a horizontal strip sprite sheet for one clip+direction and saves it to OUTPUT_DIR.
 * Also returns the frame count for atlas generation.
 *
 * @param clip - Animation clip name.
 * @param direction - Direction name.
 * @param frames - Sorted array of frame PNG paths.
 * @returns Number of frames composited, or 0 on error.
 */
async function buildSheet(clip: string, direction: string, frames: string[]): Promise<number> {
  if (frames.length === 0) return 0

  const width = FRAME_SIZE * frames.length
  const height = FRAME_SIZE
  const canvas = sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })

  const compositeInputs = frames.map((framePath, i) => ({
    input: framePath,
    left: i * FRAME_SIZE,
    top: 0,
  }))

  const outputPath = join(OUTPUT_DIR, `${clip}-${direction}.png`)
  await canvas.composite(compositeInputs).png().toFile(outputPath)
  console.log(`  ✓ ${clip}-${direction}.png (${frames.length} frames)`)
  return frames.length
}

/**
 * Main entry point: builds all sprite sheets for the lady-wizard character.
 * Iterates over all clips and directions, compositing individual frames.
 */
async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const atlas: Record<string, Record<string, number>> = {}

  for (const clip of ANIMATION_CLIPS) {
    const clipDir = join(SPRITE_DIR, "animations", clip)
    if (!existsSync(clipDir)) {
      console.warn(`⚠ Clip directory not found: ${clipDir}`)
      continue
    }

    atlas[clip] = {}
    console.log(`\nBuilding: ${clip}`)

    for (const direction of DIRECTIONS) {
      const dirPath = findDirectionDir(clipDir, direction)
      if (!dirPath) {
        console.warn(`  ⚠ Direction ${direction} not found for clip ${clip}`)
        continue
      }

      const frames = getFramePaths(dirPath)
      const frameCount = await buildSheet(clip, direction, frames)
      atlas[clip][direction] = frameCount
    }
  }

  // Write atlas manifest
  const atlasPath = join(OUTPUT_DIR, "atlas.json")
  writeFileSync(atlasPath, JSON.stringify({ frameSize: FRAME_SIZE, clips: atlas }, null, 2))
  console.log(`\n✅ Atlas manifest written to ${atlasPath}`)
}

void main().catch(console.error)
