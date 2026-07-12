/** Imports Helena's approved 124x124 source PNGs into the committed hero layout. */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import sharp from "sharp"

import {
  HERO_SPRITE_CONFIGS,
  HERO_SPRITE_DIRECTIONS,
  type HeroSpriteDirection,
} from "../src/shared/sprites/heroSprites"

const HELENA_FRAME_SIZE = HERO_SPRITE_CONFIGS.helena.frameSizePx

type SourceClipMapping = {
  readonly sourceClipDir: string | null
  readonly outputAtlasClipId: string
}

const SOURCE_CLIPS: readonly SourceClipMapping[] = [
  { sourceClipDir: null, outputAtlasClipId: "idle" },
  { sourceClipDir: "walks", outputAtlasClipId: "walks" },
  { sourceClipDir: "death", outputAtlasClipId: "death" },
  { sourceClipDir: "fire_spell", outputAtlasClipId: "fire-spell" },
  { sourceClipDir: "spell_2", outputAtlasClipId: "spell-2" },
  { sourceClipDir: "spell_3", outputAtlasClipId: "spell-3" },
  { sourceClipDir: "jump", outputAtlasClipId: "jump" },
]

function requiredPath(value: string | undefined, envName: string, usage: string): string {
  const candidate = value ?? process.env[envName]
  if (!candidate) throw new Error(usage)
  const resolved = resolve(candidate)
  if (!existsSync(resolved)) throw new Error(`Source directory not found: ${resolved}`)
  return resolved
}

function pngFramesIn(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const invalidEntry = entries.find(
    (entry) => !entry.isFile() || !entry.name.toLowerCase().endsWith(".png"),
  )
  if (invalidEntry) throw new Error(`Expected PNG frames only: ${join(dir, invalidEntry.name)}`)
  return entries
    .map((entry) => entry.name)
    .sort()
    .map((entry) => join(dir, entry))
}

async function validateAndWriteFrame(inputPath: string, outputPath: string): Promise<void> {
  const metadata = await sharp(inputPath).metadata()
  if (
    metadata.format !== "png" ||
    metadata.width !== HELENA_FRAME_SIZE ||
    metadata.height !== HELENA_FRAME_SIZE
  ) {
    throw new Error(`Expected ${HELENA_FRAME_SIZE}x${HELENA_FRAME_SIZE} PNG: ${inputPath}`)
  }
  await sharp(inputPath).png().toFile(outputPath)
}

async function importFrames(
  frames: readonly string[],
  outDir: string,
  expectedCount: number,
): Promise<void> {
  if (frames.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} frames for ${outDir}, got ${frames.length}`)
  }
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  for (let index = 0; index < frames.length; index++) {
    await validateAndWriteFrame(
      frames[index]!,
      join(outDir, `frame_${String(index).padStart(3, "0")}.png`),
    )
  }
}

/** Imports all supplied Helena clips plus a separately generated stumble clip. */
export async function importHelenaSourceFrames(
  sourceDir?: string,
  stumbleDir?: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const sourceRoot = requiredPath(
    sourceDir,
    "HELENA_SOURCE_DIR",
    "Usage: bun run import:helena-source-frames -- /path/to/Helena_Main /path/to/stumble",
  )
  const stumbleRoot = requiredPath(
    stumbleDir,
    "HELENA_STUMBLE_SOURCE_DIR",
    "Helena stumble source is required as the second argument or HELENA_STUMBLE_SOURCE_DIR",
  )
  const outputRoot = resolve(cwd, HERO_SPRITE_CONFIGS.helena.publicHeroDir, "animations")

  for (const mapping of SOURCE_CLIPS) {
    const actionClip = HERO_SPRITE_CONFIGS.helena.clipOrder.find(
      (clipId) => HERO_SPRITE_CONFIGS.helena.clips[clipId].atlasClipId === mapping.outputAtlasClipId,
    )
    if (!actionClip) throw new Error(`Missing Helena clip metadata for ${mapping.outputAtlasClipId}`)
    const expectedCount = HERO_SPRITE_CONFIGS.helena.clips[actionClip].frameCount

    for (const direction of HERO_SPRITE_DIRECTIONS) {
      const frames =
        mapping.sourceClipDir === null
          ? [join(sourceRoot, "rotations", `${direction}.png`)]
          : pngFramesIn(join(sourceRoot, "animations", mapping.sourceClipDir, direction))
      await importFrames(
        frames,
        join(outputRoot, mapping.outputAtlasClipId, direction),
        expectedCount,
      )
    }
  }

  for (const direction of HERO_SPRITE_DIRECTIONS as readonly HeroSpriteDirection[]) {
    await importFrames(
      pngFramesIn(join(stumbleRoot, direction)),
      join(outputRoot, "stumble", direction),
      HERO_SPRITE_CONFIGS.helena.clips.stumble.frameCount,
    )
  }
}

const isCliEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /import-helena-source-frames\.(ts|js|mjs|cjs)$/.test(process.argv[1])

if (isCliEntry) {
  void importHelenaSourceFrames(process.argv[2], process.argv[3]).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
