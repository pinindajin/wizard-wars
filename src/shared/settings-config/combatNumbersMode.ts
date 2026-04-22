/**
 * Combat numbers display mode options.
 * Controls how floating damage numbers are shown.
 */
export const CombatNumbersMode = {
  /** No floating damage numbers. */
  OFF: "OFF",
  /** Standard floating numbers (damage values only). */
  ON: "ON",
  /** Extended mode (damage + heal numbers). */
  ON_EXTENDED: "ON_EXTENDED",
  /** Full mode (all combat events). */
  ON_FULL: "ON_FULL",
} as const

export type CombatNumbersMode = (typeof CombatNumbersMode)[keyof typeof CombatNumbersMode]

/** Default combat numbers mode for new users. */
export const DEFAULT_COMBAT_NUMBERS_MODE: CombatNumbersMode = CombatNumbersMode.ON
