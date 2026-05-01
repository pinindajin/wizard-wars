import type Phaser from "phaser"
import {
  LAVA_LAP_ANIM_FPS,
  LAVA_LAP_FRAME_COUNT,
} from "@/shared/balance-config/combat"

/** Phaser texture key for the in-flight fireball sprite sheet. */
export const FIREBALL_FLY_TEXTURE = "fireball"
/** Phaser texture key for the channel/cast fireball sprite sheet. */
export const FIREBALL_CHANNEL_TEXTURE = "fireball-channel"
/** Phaser texture key for the lava lap overlay sprite sheet. */
export const LAVA_LAP_TEXTURE = "lava-lap"

/** Animation key consumed by `ProjectileRenderSystem` for the flying projectile. */
export const FIREBALL_FLY_ANIM = "fireball-fly"
/** Animation key consumed by `PlayerRenderSystem` for the cast channel overlay. */
export const FIREBALL_CHANNEL_ANIM = "fireball-channel"
/** Animation key consumed by `PlayerRenderSystem` while a player is in lava. */
export const LAVA_LAP_ANIM = "lava-lap"

/** Frame count baked into both fireball strips by `scripts/build-fireball-sheets.ts`. */
const FRAME_COUNT = 8

/** Channel cycles fast to read as a building cast. */
const CHANNEL_FPS = 14
/** Fly cycles slower so the pulse/spin doesn't feel jittery in flight. */
const FLY_FPS = 10

/**
 * Registers fireball flying and cast-channel animations on a scene's
 * AnimationManager. Both animations loop (`repeat: -1`) and are idempotent —
 * the function exits early if the animations already exist, mirroring the
 * pattern used by `registerLadyWizardAnims`.
 *
 * MUST run after the arena asset pack has loaded the `fireball` and
 * `fireball-channel` spritesheets and before any fireball can spawn.
 *
 * @param animManager - Phaser AnimationManager from the active scene.
 */
export const registerFireballAnims = (
  animManager: Phaser.Animations.AnimationManager,
): void => {
  if (!animManager.exists(FIREBALL_FLY_ANIM)) {
    animManager.create({
      key: FIREBALL_FLY_ANIM,
      frames: animManager.generateFrameNumbers(FIREBALL_FLY_TEXTURE, {
        start: 0,
        end: FRAME_COUNT - 1,
      }),
      frameRate: FLY_FPS,
      repeat: -1,
    })
  }

  if (!animManager.exists(FIREBALL_CHANNEL_ANIM)) {
    animManager.create({
      key: FIREBALL_CHANNEL_ANIM,
      frames: animManager.generateFrameNumbers(FIREBALL_CHANNEL_TEXTURE, {
        start: 0,
        end: FRAME_COUNT - 1,
      }),
      frameRate: CHANNEL_FPS,
      repeat: -1,
    })
  }

  if (!animManager.exists(LAVA_LAP_ANIM)) {
    animManager.create({
      key: LAVA_LAP_ANIM,
      frames: animManager.generateFrameNumbers(LAVA_LAP_TEXTURE, {
        start: 0,
        end: LAVA_LAP_FRAME_COUNT - 1,
      }),
      frameRate: LAVA_LAP_ANIM_FPS,
      repeat: -1,
    })
  }
}
