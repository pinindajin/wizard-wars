import type { PlayerAnimState } from "@/shared/types"

/**
 * Returns whether sprite direction should follow aim (mouse) vs body (last move).
 *
 * @param animState - Server-reported animation state.
 * @returns True when cast / axe clips should bucket from aim angle.
 */
export function animUsesMouseAim(animState: PlayerAnimState): boolean {
  return (
    animState === "primary_melee_attack" ||
    animState === "light_cast" ||
    animState === "heavy_cast"
  )
}
