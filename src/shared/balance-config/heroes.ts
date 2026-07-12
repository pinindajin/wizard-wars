/**
 * Hero configuration.
 */
import type { PrimaryMeleeAttackId } from "./equipment"

export type HeroId = "yen" | "triss" | "helena"

export type HeroConfig = {
  readonly id: HeroId
  readonly displayName: string
  /** Packed RGB (0xRRGGBB) for the arena foot identity ellipse. */
  readonly tint: number
  readonly spriteKey: string
  /** Hero-specific primary melee attack id (balanceable independently). */
  readonly primaryMeleeAttackId: PrimaryMeleeAttackId
}

export const HERO_CONFIGS: Record<HeroId, HeroConfig> = {
  yen: {
    id: "yen",
    displayName: "Yen",
    tint: 0xff3333,
    spriteKey: "lady-wizard",
    primaryMeleeAttackId: "yen_cleaver",
  },
  triss: {
    id: "triss",
    displayName: "Triss",
    tint: 0x33cc66,
    spriteKey: "triss",
    primaryMeleeAttackId: "triss_big_blast",
  },
  helena: {
    id: "helena",
    displayName: "Helena",
    tint: 0x3b82f6,
    spriteKey: "helena",
    primaryMeleeAttackId: "helena_energy_wave",
  },
}

export const DEFAULT_HERO_ID: HeroId = "yen"

export const VALID_HERO_IDS = Object.keys(HERO_CONFIGS) as readonly HeroId[]

/**
 * Normalizes stale or unknown hero ids to a configured hero.
 *
 * @param heroId - Public, stale, or arbitrary hero id.
 * @returns Canonical hero id.
 */
export function normalizeHeroId(heroId: string): HeroId {
  if (heroId === "triss" || heroId === "helena") return heroId
  return DEFAULT_HERO_ID
}

/**
 * Returns the configured primary melee attack id for a lobby hero selection string.
 *
 * @param heroId - Selected hero id from the client.
 * @returns The hero's attack id, or Yen's attack when `heroId` is unknown.
 */
export function getHeroPrimaryMeleeAttackId(heroId: string): PrimaryMeleeAttackId {
  return HERO_CONFIGS[normalizeHeroId(heroId)].primaryMeleeAttackId
}
