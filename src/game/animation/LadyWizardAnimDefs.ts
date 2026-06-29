import type Phaser from "phaser"

import type { PlayerAnimState } from "@/shared/types"
import {
  HERO_SPRITE_CONFIGS,
  HERO_SPRITE_DIRECTIONS,
  heroSpriteConfigFor,
  type HeroSpriteActionClipId,
  type HeroSpriteDirection,
  type HeroSpriteConfig,
} from "@/shared/sprites/heroSprites"
import {
  frameRateForDuration,
  getBehaviorAnimationConfig,
  getPrimaryAttackAnimationConfig,
  getSpellAnimationConfig,
} from "@/shared/balance-config/animationConfig"
import { DEFAULT_HERO_ID, HERO_CONFIGS, normalizeHeroId } from "@/shared/balance-config/heroes"

/**
 * 8 directions for the lady-wizard sprite sheet, in the order used for all animation keys.
 * Angles are measured from the positive X axis (east), increasing clockwise.
 */
export const DIRECTIONS = HERO_SPRITE_DIRECTIONS

export type Direction = HeroSpriteDirection

/**
 * Available animation clips for the lady-wizard sprite sheet.
 * Each clip name maps to a prefix used in the animation key.
 */
const ANIM_CLIPS: Record<PlayerAnimState, HeroSpriteActionClipId> = {
  idle: "idle",
  walk: "walk",
  dying: "death",
  dead: "death",
  light_cast: "light_spell_cast",
  heavy_cast: "heavy_spell_cast",
  primary_melee_attack: "primary_melee_attack",
  jump: "jump",
  stumble: "stumble",
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
  return getHeroAnimKey(DEFAULT_HERO_ID, animState, direction)
}

/**
 * Returns the canonical animation key for a hero, animation state, and direction.
 * Format: "{spriteKey}-{megasheetClip}-{direction}".
 *
 * @param heroId - Runtime or stale hero id.
 * @param animState - The server-reported PlayerAnimState.
 * @param direction - The 8-directional string derived from facing angle.
 * @returns Phaser animation key string.
 */
export const getHeroAnimKey = (
  heroId: string,
  animState: string,
  direction: Direction,
): string => {
  const config = heroSpriteConfigFor(heroId)
  const actionClip = ANIM_CLIPS[animState as PlayerAnimState] ?? "idle"
  const clip = config.clips[actionClip].megasheetClip
  return `${config.spriteKey}-${clip}-${direction}`
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
  return remap[index]!
}

function clipFrameDurationsMs(
  heroId: string,
  clip: HeroSpriteActionClipId,
): readonly number[] | undefined {
  const canonicalHeroId = normalizeHeroId(heroId)
  switch (clip) {
    case "idle":
      return getBehaviorAnimationConfig(canonicalHeroId, "idle").frameDurationsMs
    case "walk":
      return getBehaviorAnimationConfig(canonicalHeroId, "walk").frameDurationsMs
    case "death":
      return getBehaviorAnimationConfig(canonicalHeroId, "death").frameDurationsMs
    case "light_spell_cast":
      return getSpellAnimationConfig(canonicalHeroId, "fireball").frameDurationsMs
    case "heavy_spell_cast":
      return getSpellAnimationConfig(canonicalHeroId, "lightning_bolt").frameDurationsMs
    case "primary_melee_attack":
      return getPrimaryAttackAnimationConfig(
        canonicalHeroId,
        HERO_CONFIGS[canonicalHeroId].primaryMeleeAttackId,
      ).frameDurationsMs
    case "jump":
      return getSpellAnimationConfig(canonicalHeroId, "jump").frameDurationsMs
    case "stumble":
      return getBehaviorAnimationConfig(canonicalHeroId, "stumble").frameDurationsMs
  }
}

function clipDurationMs(heroId: string, clip: HeroSpriteActionClipId): number {
  const canonicalHeroId = normalizeHeroId(heroId)
  switch (clip) {
    case "idle":
      return getBehaviorAnimationConfig(canonicalHeroId, "idle").durationMs
    case "walk":
      return getBehaviorAnimationConfig(canonicalHeroId, "walk").durationMs
    case "death":
      return getBehaviorAnimationConfig(canonicalHeroId, "death").durationMs
    case "light_spell_cast":
      return getSpellAnimationConfig(canonicalHeroId, "fireball").durationMs
    case "heavy_spell_cast":
      return getSpellAnimationConfig(canonicalHeroId, "lightning_bolt").durationMs
    case "primary_melee_attack":
      return getPrimaryAttackAnimationConfig(
        canonicalHeroId,
        HERO_CONFIGS[canonicalHeroId].primaryMeleeAttackId,
      ).durationMs
    case "jump":
      return getSpellAnimationConfig(canonicalHeroId, "jump").durationMs
    case "stumble":
      return getBehaviorAnimationConfig(canonicalHeroId, "stumble").durationMs
  }
}

/**
 * Registers all animations for one configured hero sprite.
 *
 * @param animManager - Phaser AnimationManager from the active scene.
 * @param heroConfig - Hero sprite layout to register.
 */
function registerOneHeroSpriteAnims(
  animManager: Phaser.Animations.AnimationManager,
  heroConfig: HeroSpriteConfig,
): void {
  const LOOP_CLIPS = new Set<HeroSpriteActionClipId>(["idle", "walk", "stumble"])

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

  for (const clipId of heroConfig.clipOrder) {
    const clip = heroConfig.clips[clipId]
    const frameCount = clip.frameCount
    const baseFrame = heroConfig.clipBaseFrame[clipId]
    const perFrameMs = clipFrameDurationsMs(heroConfig.id, clipId)
    const useVariable =
      perFrameMs !== undefined && perFrameMs.length === frameCount && frameCount > 0
    const fps = frameRateForDuration(frameCount, clipDurationMs(heroConfig.id, clipId))
    const repeat = LOOP_CLIPS.has(clipId) ? -1 : 0

    for (const direction of DIRECTIONS) {
      const key = `${heroConfig.spriteKey}-${clip.megasheetClip}-${direction}`
      if (animManager.exists(key)) continue

      const rowOffset = directionRowMap[direction] * heroConfig.framesPerDirectionRow

      if (useVariable) {
        const frames: Phaser.Types.Animations.AnimationFrame[] = []
        for (let i = 0; i < frameCount; i++) {
          frames.push({
            key: heroConfig.spriteKey,
            frame: rowOffset + baseFrame + i,
            duration: perFrameMs[i]!,
          })
        }
        animManager.create({
          key,
          frames,
          repeat,
          yoyo: false,
        })
        continue
      }

      const frames = animManager.generateFrameNumbers(heroConfig.spriteKey, {
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

/**
 * Defines per-direction frame ranges for all lady-wizard animation clips on the shared
 * sprite sheet. Each direction-clip combination becomes one Phaser AnimationConfig.
 *
 * Frame numbering convention:
 *   Directions are rows; clips are column bands.
 *   Sheet is expected to have 8 rows (one per direction) and N columns split across clips.
 *
 * @param animManager - Phaser AnimationManager from the active scene.
 */
export const registerLadyWizardAnims = (animManager: Phaser.Animations.AnimationManager): void => {
  registerOneHeroSpriteAnims(animManager, HERO_SPRITE_CONFIGS.yen)
}

/**
 * Defines per-direction frame ranges for all configured hero sprite sheets.
 *
 * @param animManager - Phaser AnimationManager from the active scene.
 */
export const registerHeroSpriteAnims = (
  animManager: Phaser.Animations.AnimationManager,
): void => {
  for (const heroConfig of Object.values(HERO_SPRITE_CONFIGS)) {
    registerOneHeroSpriteAnims(animManager, heroConfig)
  }
}
