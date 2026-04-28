/**
 * Hero configuration.
 * All three heroes share the lady-wizard sprite sheet; identity color is shown in the arena
 * via a foot marker (ellipse), not by tinting the sprite.
 */
import type { PrimaryMeleeAttackId } from "./equipment"

export type HeroConfig = {
  readonly id: string
  readonly displayName: string
  /** Packed RGB (0xRRGGBB) for the arena foot identity ellipse under the shared sprite. */
  readonly tint: number
  readonly spriteKey: string
  /** Hero-specific primary melee attack id (balanceable independently). */
  readonly primaryMeleeAttackId: PrimaryMeleeAttackId
}

export const HERO_CONFIGS: Record<string, HeroConfig> = {
  red_wizard: {
    id: "red_wizard",
    displayName: "Red Wizard",
    tint: 0xff3333,
    spriteKey: "lady-wizard",
    primaryMeleeAttackId: "red_wizard_cleaver",
  },
  barbarian: {
    id: "barbarian",
    displayName: "Barbarian",
    tint: 0xff8833,
    spriteKey: "lady-wizard",
    primaryMeleeAttackId: "barbarian_cleaver",
  },
  ranger: {
    id: "ranger",
    displayName: "Ranger",
    tint: 0x33cc66,
    spriteKey: "lady-wizard",
    primaryMeleeAttackId: "ranger_cleaver",
  },
}

export const DEFAULT_HERO_ID = "red_wizard"

export const VALID_HERO_IDS = Object.keys(HERO_CONFIGS) as readonly string[]

/**
 * Returns the configured primary melee attack id for a lobby hero selection string.
 *
 * @param heroId - Selected hero id from the client.
 * @returns The hero's attack id, or the default hero's attack when `heroId` is unknown.
 */
export function getHeroPrimaryMeleeAttackId(heroId: string): PrimaryMeleeAttackId {
  const hero = HERO_CONFIGS[heroId]
  if (hero) return hero.primaryMeleeAttackId
  return HERO_CONFIGS[DEFAULT_HERO_ID].primaryMeleeAttackId
}
