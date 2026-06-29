/**
 * Shared hero sprite layout metadata for runtime animation registration,
 * build scripts, and dev sprite tooling.
 */
import type { HeroId } from "@/shared/balance-config/heroes"

export const HERO_SPRITE_DIRECTIONS = [
  "south",
  "south-east",
  "east",
  "north-east",
  "north",
  "north-west",
  "west",
  "south-west",
] as const

export type HeroSpriteDirection = (typeof HERO_SPRITE_DIRECTIONS)[number]

export type HeroSpriteActionClipId =
  | "idle"
  | "walk"
  | "death"
  | "light_spell_cast"
  | "heavy_spell_cast"
  | "primary_melee_attack"
  | "jump"
  | "stumble"

export type HeroSpriteClipConfig = {
  readonly actionClipId: HeroSpriteActionClipId
  readonly atlasClipId: string
  readonly megasheetClip: string
  readonly sheetPrefix: string
  readonly frameCount: number
  readonly fps: number
}

export type HeroSpriteConfig = {
  readonly id: HeroId
  readonly spriteKey: string
  readonly publicHeroDir: string
  readonly frameSizePx: number
  readonly displayOffsetX: number
  readonly displayOffsetY: number
  readonly clipOrder: readonly HeroSpriteActionClipId[]
  readonly clips: Record<HeroSpriteActionClipId, HeroSpriteClipConfig>
  readonly clipBaseFrame: Record<HeroSpriteActionClipId, number>
  readonly framesPerDirectionRow: number
}

const HERO_CLIP_ORDER: readonly HeroSpriteActionClipId[] = [
  "idle",
  "walk",
  "death",
  "light_spell_cast",
  "heavy_spell_cast",
  "primary_melee_attack",
  "jump",
  "stumble",
]

const YEN_CLIPS: Record<HeroSpriteActionClipId, HeroSpriteClipConfig> = {
  idle: {
    actionClipId: "idle",
    atlasClipId: "idle",
    megasheetClip: "breathing_idle",
    sheetPrefix: "idle",
    frameCount: 4,
    fps: 6,
  },
  walk: {
    actionClipId: "walk",
    atlasClipId: "walk",
    megasheetClip: "walk",
    sheetPrefix: "walk",
    frameCount: 15,
    fps: 10,
  },
  death: {
    actionClipId: "death",
    atlasClipId: "death",
    megasheetClip: "death",
    sheetPrefix: "death",
    frameCount: 17,
    fps: 10,
  },
  light_spell_cast: {
    actionClipId: "light_spell_cast",
    atlasClipId: "light-spell-cast",
    megasheetClip: "light_spell_cast",
    sheetPrefix: "light-spell-cast",
    frameCount: 17,
    fps: 12,
  },
  heavy_spell_cast: {
    actionClipId: "heavy_spell_cast",
    atlasClipId: "heavy-spell-cast",
    megasheetClip: "heavy_spell_cast",
    sheetPrefix: "heavy-spell-cast",
    frameCount: 17,
    fps: 12,
  },
  primary_melee_attack: {
    actionClipId: "primary_melee_attack",
    atlasClipId: "summoned-axe-attack",
    megasheetClip: "summoned_axe_swing",
    sheetPrefix: "summoned-axe-attack",
    frameCount: 7,
    fps: 12,
  },
  jump: {
    actionClipId: "jump",
    atlasClipId: "jump",
    megasheetClip: "jump",
    sheetPrefix: "jump",
    frameCount: 17,
    fps: 12,
  },
  stumble: {
    actionClipId: "stumble",
    atlasClipId: "stumble",
    megasheetClip: "stumble",
    sheetPrefix: "stumble",
    frameCount: 17,
    fps: 12,
  },
}

const TRISS_CLIPS: Record<HeroSpriteActionClipId, HeroSpriteClipConfig> = {
  idle: {
    actionClipId: "idle",
    atlasClipId: "idle",
    megasheetClip: "idle",
    sheetPrefix: "idle",
    frameCount: 1,
    fps: 6,
  },
  walk: {
    actionClipId: "walk",
    atlasClipId: "walk",
    megasheetClip: "walk",
    sheetPrefix: "walk",
    frameCount: 17,
    fps: 10,
  },
  death: {
    actionClipId: "death",
    atlasClipId: "death",
    megasheetClip: "death",
    sheetPrefix: "death",
    frameCount: 17,
    fps: 10,
  },
  light_spell_cast: {
    actionClipId: "light_spell_cast",
    atlasClipId: "channel-fire",
    megasheetClip: "channel_fire",
    sheetPrefix: "channel-fire",
    frameCount: 17,
    fps: 12,
  },
  heavy_spell_cast: {
    actionClipId: "heavy_spell_cast",
    atlasClipId: "ground-pound",
    megasheetClip: "ground_pound",
    sheetPrefix: "ground-pound",
    frameCount: 17,
    fps: 12,
  },
  primary_melee_attack: {
    actionClipId: "primary_melee_attack",
    atlasClipId: "big-blast",
    megasheetClip: "big_blast",
    sheetPrefix: "big-blast",
    frameCount: 17,
    fps: 12,
  },
  jump: {
    actionClipId: "jump",
    atlasClipId: "jump",
    megasheetClip: "jump",
    sheetPrefix: "jump",
    frameCount: 17,
    fps: 12,
  },
  stumble: {
    actionClipId: "stumble",
    atlasClipId: "stumble",
    megasheetClip: "stumble",
    sheetPrefix: "stumble",
    frameCount: 17,
    fps: 12,
  },
}

/**
 * Builds base-frame offsets for a hero's clip order.
 *
 * @param clips - Clip metadata keyed by action clip id.
 * @param clipOrder - Megasheet band order.
 * @returns Base frame index per clip.
 */
function buildClipBaseFrame(
  clips: Record<HeroSpriteActionClipId, HeroSpriteClipConfig>,
  clipOrder: readonly HeroSpriteActionClipId[],
): Record<HeroSpriteActionClipId, number> {
  let next = 0
  const out = {} as Record<HeroSpriteActionClipId, number>
  for (const clipId of clipOrder) {
    out[clipId] = next
    next += clips[clipId].frameCount
  }
  return out
}

/**
 * Computes total frames per direction row.
 *
 * @param clips - Clip metadata keyed by action clip id.
 * @param clipOrder - Megasheet band order.
 * @returns Number of frames in one megasheet row.
 */
function framesPerDirectionRow(
  clips: Record<HeroSpriteActionClipId, HeroSpriteClipConfig>,
  clipOrder: readonly HeroSpriteActionClipId[],
): number {
  return clipOrder.reduce((sum, clipId) => sum + clips[clipId].frameCount, 0)
}

export const HERO_SPRITE_CONFIGS: Record<HeroId, HeroSpriteConfig> = {
  yen: {
    id: "yen",
    spriteKey: "lady-wizard",
    publicHeroDir: "public/assets/sprites/heroes/lady-wizard",
    frameSizePx: 124,
    displayOffsetX: 0,
    displayOffsetY: 45,
    clipOrder: HERO_CLIP_ORDER,
    clips: YEN_CLIPS,
    clipBaseFrame: buildClipBaseFrame(YEN_CLIPS, HERO_CLIP_ORDER),
    framesPerDirectionRow: framesPerDirectionRow(YEN_CLIPS, HERO_CLIP_ORDER),
  },
  triss: {
    id: "triss",
    spriteKey: "triss",
    publicHeroDir: "public/assets/sprites/heroes/triss",
    frameSizePx: 124,
    displayOffsetX: 0,
    displayOffsetY: 45,
    clipOrder: HERO_CLIP_ORDER,
    clips: TRISS_CLIPS,
    clipBaseFrame: buildClipBaseFrame(TRISS_CLIPS, HERO_CLIP_ORDER),
    framesPerDirectionRow: framesPerDirectionRow(TRISS_CLIPS, HERO_CLIP_ORDER),
  },
}

/**
 * Normalizes a hero id for sprite metadata lookups.
 *
 * @param heroId - Runtime or stale hero id.
 * @returns A configured hero sprite id.
 */
export function normalizeHeroSpriteId(heroId: string): HeroId {
  return heroId === "triss" ? "triss" : "yen"
}

/**
 * Returns sprite metadata for a hero id, defaulting stale ids to Yen.
 *
 * @param heroId - Runtime or stale hero id.
 * @returns Hero sprite config.
 */
export function heroSpriteConfigFor(heroId: string): HeroSpriteConfig {
  return HERO_SPRITE_CONFIGS[normalizeHeroSpriteId(heroId)]
}

/**
 * Finds the sprite action clip used by an atlas clip id.
 *
 * @param heroId - Runtime or stale hero id.
 * @param atlasClipId - Clip id used in atlas filenames.
 * @returns Matching action clip id, or null.
 */
export function heroSpriteActionClipForAtlasClip(
  heroId: string,
  atlasClipId: string,
): HeroSpriteActionClipId | null {
  const config = heroSpriteConfigFor(heroId)
  const match = config.clipOrder.find((clipId) => config.clips[clipId].atlasClipId === atlasClipId)
  return match ?? null
}

/**
 * Builds a root-relative public strip URL.
 *
 * @param heroId - Runtime or stale hero id.
 * @param atlasClipId - Atlas clip id.
 * @param direction - Direction string.
 * @returns Public URL beginning with `/assets`.
 */
export function heroStripPublicPath(
  heroId: string,
  atlasClipId: string,
  direction: string,
): string {
  const config = heroSpriteConfigFor(heroId)
  return `/${config.publicHeroDir.replace(/^public\//, "")}/sheets/${atlasClipId}-${direction}.png`
}

/**
 * Builds the root-relative public atlas JSON URL.
 *
 * @param heroId - Runtime or stale hero id.
 * @returns Public URL beginning with `/assets`.
 */
export function heroAtlasPublicPath(heroId: string): string {
  const config = heroSpriteConfigFor(heroId)
  return `/${config.publicHeroDir.replace(/^public\//, "")}/sheets/atlas.json`
}

/**
 * Builds the root-relative public megasheet URL.
 *
 * @param heroId - Runtime or stale hero id.
 * @returns Public URL beginning with `/assets`.
 */
export function heroMegasheetPublicPath(heroId: string): string {
  const config = heroSpriteConfigFor(heroId)
  return `/${config.publicHeroDir.replace(/^public\//, "")}/sheets/${config.spriteKey}-megasheet.png`
}

/**
 * Builds an absolute filesystem path for a strip PNG.
 *
 * @param heroId - Runtime or stale hero id.
 * @param atlasClipId - Atlas clip id.
 * @param direction - Direction string.
 * @param cwd - Repository working directory.
 * @returns Absolute path.
 */
export function heroStripFsPath(
  heroId: string,
  atlasClipId: string,
  direction: string,
  cwd: string = process.cwd(),
): string {
  const config = heroSpriteConfigFor(heroId)
  return `${cwd}/${config.publicHeroDir}/sheets/${atlasClipId}-${direction}.png`
}

/**
 * Builds an absolute filesystem path for a source frame folder.
 *
 * @param heroId - Runtime or stale hero id.
 * @param atlasClipId - Atlas clip id.
 * @param direction - Direction string.
 * @param cwd - Repository working directory.
 * @returns Absolute path.
 */
export function heroAnimationsFramesFsDir(
  heroId: string,
  atlasClipId: string,
  direction: string,
  cwd: string = process.cwd(),
): string {
  const config = heroSpriteConfigFor(heroId)
  return `${cwd}/${config.publicHeroDir}/animations/${atlasClipId}/${direction}`
}

/**
 * Builds an absolute filesystem path for archived strips.
 *
 * @param heroId - Runtime or stale hero id.
 * @param cwd - Repository working directory.
 * @returns Absolute path.
 */
export function heroSheetsArchiveFsDir(heroId: string, cwd: string = process.cwd()): string {
  const config = heroSpriteConfigFor(heroId)
  return `${cwd}/${config.publicHeroDir}/sheets/old`
}

/**
 * Builds an absolute filesystem path for archived animation frames.
 *
 * @param heroId - Runtime or stale hero id.
 * @param atlasClipId - Atlas clip id.
 * @param cwd - Repository working directory.
 * @returns Absolute path.
 */
export function heroAnimationsArchiveFsDir(
  heroId: string,
  atlasClipId: string,
  cwd: string = process.cwd(),
): string {
  const config = heroSpriteConfigFor(heroId)
  return `${cwd}/${config.publicHeroDir}/animations/old/${atlasClipId}`
}

/**
 * Builds an absolute filesystem path for the sheets directory.
 *
 * @param heroId - Runtime or stale hero id.
 * @param cwd - Repository working directory.
 * @returns Absolute path.
 */
export function heroSheetsFsDir(heroId: string, cwd: string = process.cwd()): string {
  const config = heroSpriteConfigFor(heroId)
  return `${cwd}/${config.publicHeroDir}/sheets`
}

/**
 * Builds an absolute filesystem path for atlas.json.
 *
 * @param heroId - Runtime or stale hero id.
 * @param cwd - Repository working directory.
 * @returns Absolute path.
 */
export function heroAtlasFsPath(heroId: string, cwd: string = process.cwd()): string {
  return `${heroSheetsFsDir(heroId, cwd)}/atlas.json`
}

/**
 * Builds an absolute filesystem path for the hero megasheet.
 *
 * @param heroId - Runtime or stale hero id.
 * @param cwd - Repository working directory.
 * @returns Absolute path.
 */
export function heroMegasheetFsPath(heroId: string, cwd: string = process.cwd()): string {
  const config = heroSpriteConfigFor(heroId)
  return `${heroSheetsFsDir(heroId, cwd)}/${config.spriteKey}-megasheet.png`
}
