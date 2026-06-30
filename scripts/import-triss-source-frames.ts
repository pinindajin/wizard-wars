/**
 * Imports the approved Triss source PNG folders into the committed hero asset layout.
 *
 * Source frames are 120x120. Runtime hero sheets use 124x124 frames, so each source frame is
 * placed at left=2/top=4 on a transparent canvas, preserving bottom alignment.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import sharp from "sharp"

import {
  HERO_SPRITE_CONFIGS,
  HERO_SPRITE_DIRECTIONS,
  type HeroSpriteDirection,
} from "../src/shared/sprites/heroSprites"

const TRISS_FRAME_SIZE = HERO_SPRITE_CONFIGS.triss.frameSizePx
const SOURCE_FRAME_SIZE = 120
const PAD_LEFT = 2
const PAD_TOP = 4

type SourceClipMapping = {
  readonly sourceClipDir: string | null
  readonly outputAtlasClipId: string
}

const SOURCE_CLIPS: readonly SourceClipMapping[] = [
  { sourceClipDir: null, outputAtlasClipId: "idle" },
  { sourceClipDir: "walk", outputAtlasClipId: "walk" },
  { sourceClipDir: "death", outputAtlasClipId: "death" },
  { sourceClipDir: "channel_fire", outputAtlasClipId: "channel-fire" },
  { sourceClipDir: "ground_pound", outputAtlasClipId: "ground-pound" },
  { sourceClipDir: "big_blast", outputAtlasClipId: "big-blast" },
  { sourceClipDir: "jump", outputAtlasClipId: "jump" },
  { sourceClipDir: "stumble", outputAtlasClipId: "stumble" },
]

const DIRECTION_SOURCE_ALIASES: Record<string, Record<HeroSpriteDirection, string>> = {
  jump: {
    south: "south",
    "south-east": "south-east",
    east: "east",
    "north-east": "north-east",
    north: "north",
    "north-west": "north-west-15ae4bca",
    west: "west-5844a1a1",
    "south-west": "south-west",
  },
}

/**
 * Resolves the required source directory from a CLI argument or environment variable.
 *
 * @param sourceDir - Optional source directory argument.
 * @returns Source directory path.
 */
function requiredSourceDir(sourceDir?: string): string {
  const candidate = sourceDir ?? process.env.TRISS_SOURCE_DIR
  if (!candidate) {
    throw new Error(
      "Triss source directory is required. Usage: bun run import:triss-source-frames -- /path/to/Triss_v3_better_64p or set TRISS_SOURCE_DIR.",
    )
  }
  return candidate
}

/**
 * Returns sorted PNG file paths from a directory.
 *
 * @param dir - Directory containing PNG frames.
 * @returns Sorted absolute paths.
 */
function pngFramesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.toLowerCase().endsWith(".png"))
    .sort()
    .map((entry) => join(dir, entry))
}

/**
 * Resolves the source directory name for a clip and direction.
 *
 * @param sourceDir - Root source asset directory.
 * @param sourceClipDir - Source clip folder name.
 * @param direction - Canonical direction.
 * @returns Absolute source directory path.
 */
function sourceDirectionDir(
  sourceDir: string,
  sourceClipDir: string,
  direction: HeroSpriteDirection,
): string {
  const alias = DIRECTION_SOURCE_ALIASES[sourceClipDir]?.[direction] ?? direction
  return join(sourceDir, "animations", sourceClipDir, alias)
}

/**
 * Pads one 120x120 Triss source PNG to the runtime 124x124 frame size.
 *
 * @param inputPath - Source PNG path.
 * @param outputPath - Destination PNG path.
 */
async function padTrissFrame(inputPath: string, outputPath: string): Promise<void> {
  const meta = await sharp(inputPath).metadata()
  if (meta.width !== SOURCE_FRAME_SIZE || meta.height !== SOURCE_FRAME_SIZE) {
    throw new Error(`Expected ${SOURCE_FRAME_SIZE}x${SOURCE_FRAME_SIZE} source frame: ${inputPath}`)
  }

  await sharp({
    create: {
      width: TRISS_FRAME_SIZE,
      height: TRISS_FRAME_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: inputPath, left: PAD_LEFT, top: PAD_TOP }])
    .png()
    .toFile(outputPath)
}

/**
 * Imports one clip and direction into the committed Triss frame layout.
 *
 * @param frames - Source PNG frame paths.
 * @param outDir - Destination directory.
 */
async function importFrames(frames: readonly string[], outDir: string): Promise<void> {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  for (let i = 0; i < frames.length; i++) {
    await padTrissFrame(frames[i]!, join(outDir, `frame_${String(i).padStart(3, "0")}.png`))
  }
}

/**
 * Imports all Triss source frames into `public/assets/sprites/heroes/triss/animations`.
 *
 * @param sourceDir - Root source asset directory.
 * @param cwd - Repository working directory.
 */
export async function importTrissSourceFrames(
  sourceDir?: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const resolvedSourceDir = resolve(requiredSourceDir(sourceDir))
  if (!existsSync(resolvedSourceDir)) {
    throw new Error(`Triss source directory not found: ${resolvedSourceDir}`)
  }

  const outputRoot = resolve(cwd, HERO_SPRITE_CONFIGS.triss.publicHeroDir, "animations")

  for (const mapping of SOURCE_CLIPS) {
    for (const direction of HERO_SPRITE_DIRECTIONS) {
      const outDir = join(outputRoot, mapping.outputAtlasClipId, direction)
      if (mapping.sourceClipDir === null) {
        await importFrames([join(resolvedSourceDir, "rotations", `${direction}.png`)], outDir)
        continue
      }

      const sourceDirForDirection = sourceDirectionDir(
        resolvedSourceDir,
        mapping.sourceClipDir,
        direction,
      )
      if (!existsSync(sourceDirForDirection)) {
        throw new Error(`Missing Triss source direction folder: ${sourceDirForDirection}`)
      }
      await importFrames(pngFramesIn(sourceDirForDirection), outDir)
    }
  }
}

const isCliEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /import-triss-source-frames\.(ts|js|mjs|cjs)$/.test(process.argv[1])

if (isCliEntry) {
  void importTrissSourceFrames(process.argv[2]).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
