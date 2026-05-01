/**
 * Shared lady-wizard sprite layout: frame size, directions, megasheet clip bands,
 * and atlas sheet naming. Consumed by Phaser anim registration, asset build scripts,
 * and the dev sprite viewer so layout cannot drift.
 */

/** Pixel width/height of one lady-wizard cel (matches `frameSize` in sheets/atlas.json). */
export const LADY_WIZARD_FRAME_SIZE_PX = 124

/**
 * Visual nudge of the lady-wizard sprite texture in world pixels (Phaser `setPosition` after origin).
 * Matches `PlayerRenderSystem` / nametag layout contract.
 */
export const LADY_WIZARD_SPRITE_DISPLAY_OFFSET_X = 0
export const LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y = 45

/**
 * Eight compass directions for megasheet rows and Phaser animation keys (south-first order).
 */
export const LADY_WIZARD_DIRECTIONS = [
  "south",
  "south-east",
  "east",
  "north-east",
  "north",
  "north-west",
  "west",
  "south-west",
] as const

export type LadyWizardDirection = (typeof LADY_WIZARD_DIRECTIONS)[number]

/**
 * Frame counts per megasheet clip band — must match padded slot width in
 * `lady-wizard-megasheet.png` and `public/.../sheets/atlas.json` logical widths.
 */
export const LADY_WIZARD_CLIP_FRAMES = {
  breathing_idle: 4,
  walk: 15,
  death: 17,
  light_spell_cast: 17,
  heavy_spell_cast: 17,
  summoned_axe_swing: 17,
  jump: 17,
} as const

export type LadyWizardMegasheetClip = keyof typeof LADY_WIZARD_CLIP_FRAMES

/**
 * Base frame index per clip within one direction row (0-based column in megasheet frames).
 */
export const LADY_WIZARD_CLIP_BASE_FRAME: Record<LadyWizardMegasheetClip, number> = {
  breathing_idle: 0,
  walk: 4,
  death: 19,
  light_spell_cast: 36,
  heavy_spell_cast: 53,
  summoned_axe_swing: 70,
  jump: 87,
}

/**
 * Maps megasheet clip id to per-direction strip filename prefix under `sheets/`
 * (e.g. `breathing_idle` → `idle-south.png`).
 */
export const LADY_WIZARD_CLIP_TO_SHEET_PREFIX: Record<LadyWizardMegasheetClip, string> = {
  breathing_idle: "idle",
  walk: "walk",
  death: "death",
  light_spell_cast: "light-spell-cast",
  heavy_spell_cast: "heavy-spell-cast",
  summoned_axe_swing: "summoned-axe-attack",
  jump: "jump",
}

/**
 * Iteration order for megasheet columns / Phaser `registerLadyWizardAnims` (left-to-right bands).
 */
export const LADY_WIZARD_MEGASHEET_CLIP_ORDER: readonly LadyWizardMegasheetClip[] = [
  "breathing_idle",
  "walk",
  "death",
  "light_spell_cast",
  "heavy_spell_cast",
  "summoned_axe_swing",
  "jump",
]

/**
 * Width in megasheet frames for one direction row (last band end + 1).
 */
export const LADY_WIZARD_FRAMES_PER_DIRECTION_ROW =
  LADY_WIZARD_CLIP_BASE_FRAME.jump + LADY_WIZARD_CLIP_FRAMES.jump

/**
 * Default animation frame rates (fps) per megasheet clip for Phaser and the sprite viewer.
 */
export const LADY_WIZARD_CLIP_FPS: Record<LadyWizardMegasheetClip, number> = {
  breathing_idle: 6,
  walk: 10,
  death: 10,
  light_spell_cast: 12,
  heavy_spell_cast: 12,
  summoned_axe_swing: 12,
  jump: 12,
}

/**
 * Clip folder names under `public/.../lady-wizard/animations/` and keys in `atlas.json`.
 */
export const LADY_WIZARD_ATLAS_CLIP_IDS = [
  "walk",
  "idle",
  "death",
  "light-spell-cast",
  "heavy-spell-cast",
  "summoned-axe-attack",
  "jump",
] as const

export type LadyWizardAtlasClipId = (typeof LADY_WIZARD_ATLAS_CLIP_IDS)[number]

/**
 * Maps atlas / sheet filename clip segment to megasheet clip id.
 */
export const LADY_WIZARD_ATLAS_CLIP_TO_MEGASHEET: Record<LadyWizardAtlasClipId, LadyWizardMegasheetClip> = {
  walk: "walk",
  idle: "breathing_idle",
  death: "death",
  "light-spell-cast": "light_spell_cast",
  "heavy-spell-cast": "heavy_spell_cast",
  "summoned-axe-attack": "summoned_axe_swing",
  jump: "jump",
}

/** Root-relative URL directory for shipped strip PNGs and atlas.json. */
export const LADY_WIZARD_SHEETS_PUBLIC_DIR = "/assets/sprites/heroes/lady-wizard/sheets"

/**
 * Returns the root-relative URL for a shipped horizontal strip PNG.
 *
 * @param atlasClipId - Clip key as in atlas.json (kebab-case).
 * @param direction - Direction string (e.g. `south-east`).
 * @returns Path beginning with `/assets/...`.
 */
export function ladyWizardStripPublicPath(atlasClipId: string, direction: string): string {
  return `${LADY_WIZARD_SHEETS_PUBLIC_DIR}/${atlasClipId}-${direction}.png`
}

/**
 * Returns the root-relative URL for committed atlas.json.
 *
 * @returns Path beginning with `/assets/...`.
 */
export function ladyWizardAtlasPublicPath(): string {
  return `${LADY_WIZARD_SHEETS_PUBLIC_DIR}/atlas.json`
}

/** Repo-relative directory of the lady-wizard hero asset root, under `public/`. */
export const LADY_WIZARD_PUBLIC_HERO_DIR =
  "public/assets/sprites/heroes/lady-wizard"

/**
 * Absolute on-disk path of a per-clip-direction strip PNG. Used by dev-only
 * endpoints that mutate strip files. `cwd` defaults to `process.cwd()`.
 */
export function ladyWizardStripFsPath(
  atlasClipId: string,
  direction: string,
  cwd: string = process.cwd(),
): string {
  return `${cwd}/${LADY_WIZARD_PUBLIC_HERO_DIR}/sheets/${atlasClipId}-${direction}.png`
}

/** Absolute on-disk dir of per-frame source PNGs for a clip+direction. */
export function ladyWizardAnimationsFramesFsDir(
  atlasClipId: string,
  direction: string,
  cwd: string = process.cwd(),
): string {
  return `${cwd}/${LADY_WIZARD_PUBLIC_HERO_DIR}/animations/${atlasClipId}/${direction}`
}

/** Absolute on-disk dir for archived strips. */
export function ladyWizardSheetsArchiveFsDir(cwd: string = process.cwd()): string {
  return `${cwd}/${LADY_WIZARD_PUBLIC_HERO_DIR}/sheets/old`
}

/** Absolute on-disk dir for archived animation frame folders, namespaced by clip. */
export function ladyWizardAnimationsArchiveFsDir(
  atlasClipId: string,
  cwd: string = process.cwd(),
): string {
  return `${cwd}/${LADY_WIZARD_PUBLIC_HERO_DIR}/animations/old/${atlasClipId}`
}

/** Absolute on-disk dir of `sheets/`. */
export function ladyWizardSheetsFsDir(cwd: string = process.cwd()): string {
  return `${cwd}/${LADY_WIZARD_PUBLIC_HERO_DIR}/sheets`
}

/** Absolute on-disk path of atlas.json. */
export function ladyWizardAtlasFsPath(cwd: string = process.cwd()): string {
  return `${cwd}/${LADY_WIZARD_PUBLIC_HERO_DIR}/sheets/atlas.json`
}
