import type Phaser from "phaser"

import type { PlayerAnimState } from "@/shared/types"

/**
 * 8 directions for the lady-wizard sprite sheet, in the order used for all animation keys.
 * Angles are measured from the positive X axis (east), increasing clockwise.
 */
export const DIRECTIONS = [
  "south",
  "south-east",
  "east",
  "north-east",
  "north",
  "north-west",
  "west",
  "south-west",
] as const

export type Direction = (typeof DIRECTIONS)[number]

/**
 * Available animation clips for the lady-wizard sprite sheet.
 * Each clip name maps to a prefix used in the animation key.
 */
const ANIM_CLIPS: Record<PlayerAnimState, string> = {
  idle: "breathing_idle",
  walk: "walk",
  dying: "death",
  dead: "death",
  light_cast: "light_spell_cast",
  heavy_cast: "heavy_spell_cast",
  axe_swing: "summoned_axe_swing",
}

/**
 * Returns the canonical animation key for a given player animation state and direction.
 * Format: "lady-wizard-{clip}-{direction}"
 * Example: "lady-wizard-walk-south-east"
 *
 * @param animState - The server-reported PlayerAnimState.
 * @param direction - The 8-directional string derived from facing angle.
 * @returns Phaser animation key string.
 */
export const getAnimKey = (animState: string, direction: Direction): string => {
  const clip = ANIM_CLIPS[animState as PlayerAnimState] ?? "breathing_idle"
  return `lady-wizard-${clip}-${direction}`
}

/**
 * Maps a facing angle (radians, 0 = east, increasing clockwise) to the nearest
 * of the 8 compass directions used by the lady-wizard sprite sheet.
 *
 * @param angle - Facing angle in radians.
 * @returns The nearest Direction string.
 */
export const getDirectionFromAngle = (angle: number): Direction => {
  // Normalise to [0, 2π)
  const TAU = Math.PI * 2
  const normalised = ((angle % TAU) + TAU) % TAU
  // Each octant is π/4 wide; offset by π/8 so boundaries fall between directions
  const index = Math.round(normalised / (Math.PI / 4)) % 8
  // Index 0 = east, but DIRECTIONS[0] = south → remap so north-of-screen = "north"
  // Remap: east=2, south-east=1, south=0, south-west=7, west=6, north-west=5, north=4, north-east=3
  const remap: Direction[] = [
    "east",
    "south-east",
    "south",
    "south-west",
    "west",
    "north-west",
    "north",
    "north-east",
  ]
  return remap[index] ?? "south"
}

/**
 * Defines per-direction frame ranges for all lady-wizard animation clips on the shared
 * sprite sheet. Each direction-clip combination becomes one Phaser AnimationConfig.
 *
 * Frame numbering convention (example — adjust to your actual sheet):
 *   Directions are rows; clips are column bands.
 *   Sheet is expected to have 8 rows (one per direction) and N columns split across clips.
 *
 * @param animManager - Phaser AnimationManager from the active scene.
 */
export const registerLadyWizardAnims = (animManager: Phaser.Animations.AnimationManager): void => {
  const TEXTURE = "lady-wizard"

  /**
   * Frame counts per clip — must match `public/.../sheets/atlas.json` and the
   * `scripts/build-lady-wizard-megasheet.ts` layout.
   */
  const CLIP_FRAMES: Record<string, number> = {
    breathing_idle: 4,
    walk: 15,
    death: 17,
    light_spell_cast: 17,
    heavy_spell_cast: 17,
    summoned_axe_swing: 17,
  }

  /** Base frame offsets per clip (row-major, one strip per direction row). */
  const CLIP_BASE_FRAME: Record<string, number> = {
    breathing_idle: 0,
    walk: 4,
    death: 19,
    light_spell_cast: 36,
    heavy_spell_cast: 53,
    summoned_axe_swing: 70,
  }

  /** Width in frames of one direction row in `lady-wizard-megasheet.png`. */
  const FRAMES_PER_DIRECTION_ROW = 87

  const CLIP_FPS: Record<string, number> = {
    breathing_idle: 6,
    walk: 10,
    death: 10,
    light_spell_cast: 12,
    heavy_spell_cast: 12,
    summoned_axe_swing: 12,
  }

  const LOOP_CLIPS = new Set(["breathing_idle", "walk"])

  const directionRowMap: Record<Direction, number> = {
    south: 0,
    "south-east": 1,
    east: 2,
    "north-east": 3,
    north: 4,
    "north-west": 5,
    west: 6,
    "south-west": 7,
  }

  for (const clip of Object.keys(CLIP_FRAMES)) {
    const frameCount = CLIP_FRAMES[clip]
    const baseFrame = CLIP_BASE_FRAME[clip]
    const fps = CLIP_FPS[clip]
    const repeat = LOOP_CLIPS.has(clip) ? -1 : 0

    for (const direction of DIRECTIONS) {
      const key = `lady-wizard-${clip}-${direction}`
      if (animManager.exists(key)) continue

      const rowOffset = directionRowMap[direction] * FRAMES_PER_DIRECTION_ROW
      const frames = animManager.generateFrameNumbers(TEXTURE, {
        start: rowOffset + baseFrame,
        end: rowOffset + baseFrame + frameCount - 1,
      })

      animManager.create({
        key,
        frames,
        frameRate: fps,
        repeat,
        yoyo: false,
      })
    }
  }
}
