/**
 * Hero configuration.
 * All three heroes share the lady-wizard sprite sheet; only the color tint differs for MVP.
 */
export type HeroConfig = {
  readonly id: string
  readonly displayName: string
  /** Phaser tint applied to the shared lady-wizard sprite. */
  readonly tint: number
  readonly spriteKey: string
}

export const HERO_CONFIGS: Record<string, HeroConfig> = {
  red_wizard: {
    id: "red_wizard",
    displayName: "Red Wizard",
    tint: 0xff3333,
    spriteKey: "lady-wizard",
  },
  barbarian: {
    id: "barbarian",
    displayName: "Barbarian",
    tint: 0xff8833,
    spriteKey: "lady-wizard",
  },
  ranger: {
    id: "ranger",
    displayName: "Ranger",
    tint: 0x33cc66,
    spriteKey: "lady-wizard",
  },
}

export const DEFAULT_HERO_ID = "red_wizard"

export const VALID_HERO_IDS = Object.keys(HERO_CONFIGS) as readonly string[]
