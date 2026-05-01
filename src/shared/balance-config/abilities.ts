import {
  FIREBALL_COOLDOWN_MS,
  LIGHTNING_COOLDOWN_MS,
  FIREBALL_CAST_MS,
  LIGHTNING_CAST_MS,
  JUMP_COOLDOWN_MS,
} from "./combat"
import { DamageProperty, combineDamageProperties } from "./damage"

/** Configuration shape for a castable ability. */
export type AbilityConfig = {
  readonly id: string
  readonly displayName: string
  /** If true, the caster can keep moving during the cast animation. */
  readonly quick: boolean
  /**
   * Default cast animation lock duration in ms.
   * Runtime cast timing is loaded from `src/shared/balance-config/animation-config.json`.
   */
  readonly castMs: number
  /** Cooldown after cast animation completes, in ms. */
  readonly cooldownMs: number
  /** Damage properties bitmask (0 if no damage). */
  readonly damageProperties: number
  /** SFX key for the cast sound. */
  readonly castSfxKey: string
  /**
   * Movement during cast: `0` = root, `1` = full speed, fractional = reduced
   * (multiplies the normal WASD step from movementSystem).
   */
  readonly castMoveSpeedMultiplier: number
}

export const ABILITY_CONFIGS: Record<string, AbilityConfig> = {
  fireball: {
    id: "fireball",
    displayName: "Fireball",
    quick: false,
    castMs: FIREBALL_CAST_MS,
    cooldownMs: FIREBALL_COOLDOWN_MS,
    damageProperties: combineDamageProperties(DamageProperty.Magic, DamageProperty.Fire),
    castSfxKey: "sfx-fireball-cast",
    castMoveSpeedMultiplier: 1.0,
  },
  lightning_bolt: {
    id: "lightning_bolt",
    displayName: "Lightning Bolt",
    quick: false,
    castMs: LIGHTNING_CAST_MS,
    cooldownMs: LIGHTNING_COOLDOWN_MS,
    damageProperties: combineDamageProperties(DamageProperty.Magic, DamageProperty.Electric),
    castSfxKey: "sfx-lightning-cast",
    castMoveSpeedMultiplier: 0,
  },
  jump: {
    id: "jump",
    displayName: "Jump",
    /** Jump does not use `Casting`; vertical arc is `JumpArc`, horizontal movement is movementSystem. */
    quick: true,
    castMs: 0,
    cooldownMs: JUMP_COOLDOWN_MS,
    damageProperties: 0,
    castSfxKey: "sfx-jump",
    castMoveSpeedMultiplier: 1.0,
  },
}

/** Which ability is auto-assigned to slot 0 for every hero at match start. */
export const DEFAULT_ABILITY_SLOT_0_ID = "fireball"
