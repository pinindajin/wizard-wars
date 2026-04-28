import {
  AXE_SWING_DURATION_MS,
  AXE_DAMAGE,
  AXE_SWING_ARC_DEG,
  AXE_SWING_RADIUS_PX,
  SWIFT_BOOTS_SPEED_BONUS,
} from "./combat"
import { DamageProperty, combineDamageProperties } from "./damage"

/** Configuration shape for an equippable weapon (legacy shop catalog). */
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

/** Canonical ids for each hero's primary cleaver-style melee (balanceable per hero). */
export type PrimaryMeleeAttackId = "red_wizard_cleaver" | "barbarian_cleaver" | "ranger_cleaver"

/** Server-authoritative tuning for a hero primary melee cone attack. */
export type PrimaryMeleeAttackConfig = {
  readonly id: PrimaryMeleeAttackId
  readonly displayName: string
  readonly damage: number
  readonly radiusPx: number
  readonly arcDeg: number
  readonly durationMs: number
  readonly damageProperties: number
  readonly swingSfxKey: string
}

const cleaverBase: Omit<PrimaryMeleeAttackConfig, "id" | "displayName"> = {
  damage: AXE_DAMAGE,
  radiusPx: AXE_SWING_RADIUS_PX,
  arcDeg: AXE_SWING_ARC_DEG,
  durationMs: AXE_SWING_DURATION_MS,
  damageProperties: combineDamageProperties(DamageProperty.Physical, DamageProperty.Slashing),
  swingSfxKey: "sfx-axe-swing",
}

/** Per-hero primary melee configs; values initially match legacy axe tuning. */
export const PRIMARY_MELEE_ATTACK_CONFIGS: Record<PrimaryMeleeAttackId, PrimaryMeleeAttackConfig> = {
  red_wizard_cleaver: {
    id: "red_wizard_cleaver",
    displayName: "Red Wizard Cleaver",
    ...cleaverBase,
  },
  barbarian_cleaver: {
    id: "barbarian_cleaver",
    displayName: "Barbarian Cleaver",
    ...cleaverBase,
  },
  ranger_cleaver: {
    id: "ranger_cleaver",
    displayName: "Ranger Cleaver",
    ...cleaverBase,
  },
}

/** Stable index order for ECS `Equipment.primaryMeleeAttackIndex`. */
export const PRIMARY_MELEE_ATTACK_IDS: readonly PrimaryMeleeAttackId[] = [
  "red_wizard_cleaver",
  "barbarian_cleaver",
  "ranger_cleaver",
]

/**
 * Maps a primary melee attack id to its ECS index.
 *
 * @param id - Attack id.
 * @returns Index 0–2, or -1 if unknown.
 */
export function primaryMeleeAttackIdToIndex(id: PrimaryMeleeAttackId): number {
  return PRIMARY_MELEE_ATTACK_IDS.indexOf(id)
}

/**
 * Resolves attack id from ECS index.
 *
 * @param index - Stored index on the entity.
 * @returns Attack id or null when out of range.
 */
export function primaryMeleeAttackIndexToId(index: number): PrimaryMeleeAttackId | null {
  if (index < 0 || index >= PRIMARY_MELEE_ATTACK_IDS.length) return null
  return PRIMARY_MELEE_ATTACK_IDS[index]!
}
