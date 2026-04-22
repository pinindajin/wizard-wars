/**
 * Damage property bitmask for composable damage types.
 * Each source can carry multiple properties (e.g. Fireball = Magic | Fire).
 * MVP: informational only; used for future armor/resistance system.
 */
export const DamageProperty = {
  Physical: 1 << 0, // 0b0001 = 1
  Magic: 1 << 1,    // 0b0010 = 2
  Slashing: 1 << 2, // 0b0100 = 4
  Fire: 1 << 3,     // 0b1000 = 8
  Electric: 1 << 4, // 0b10000 = 16
} as const

export type DamageProperty = (typeof DamageProperty)[keyof typeof DamageProperty]

/**
 * Combines multiple DamageProperty flags into a single Uint32 bitmask.
 *
 * @param flags - One or more DamageProperty values.
 * @returns Uint32 bitmask of all supplied flags OR'd together.
 */
export const combineDamageProperties = (...flags: readonly number[]): number => {
  return flags.reduce((acc, f) => acc | f, 0)
}

/**
 * Checks whether a bitmask contains a specific DamageProperty flag.
 *
 * @param mask - The combined bitmask to test.
 * @param flag - The DamageProperty flag to look for.
 * @returns `true` if the flag is set in the mask.
 */
export const hasDamageProperty = (mask: number, flag: number): boolean => {
  return (mask & flag) !== 0
}
