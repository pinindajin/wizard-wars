import { AXE_SWING_DURATION_MS, SWIFT_BOOTS_SPEED_BONUS } from "./combat"
import { DamageProperty, combineDamageProperties } from "./damage"

/** Configuration shape for an equippable weapon. */
export type WeaponConfig = {
  readonly id: string
  readonly displayName: string
  readonly swingDurationMs: number
  readonly damageProperties: number
  /** SFX key for the swing sound. */
  readonly swingSfxKey: string
}

/** Configuration shape for an equippable augment. */
export type AugmentConfig = {
  readonly id: string
  readonly displayName: string
  /** Whether multiple copies can be stacked (false = only one purchase per match). */
  readonly stackable: boolean
  /** Flat move speed multiplier bonus (e.g. 0.1 = +10%). */
  readonly moveSpeedBonus?: number
}

export const WEAPON_CONFIGS: Record<string, WeaponConfig> = {
  axe: {
    id: "axe",
    displayName: "Axe",
    swingDurationMs: AXE_SWING_DURATION_MS,
    damageProperties: combineDamageProperties(DamageProperty.Physical, DamageProperty.Slashing),
    swingSfxKey: "sfx-axe-swing",
  },
}

export const AUGMENT_CONFIGS: Record<string, AugmentConfig> = {
  swift_boots: {
    id: "swift_boots",
    displayName: "Swift Boots",
    stackable: false,
    moveSpeedBonus: SWIFT_BOOTS_SPEED_BONUS,
  },
}
