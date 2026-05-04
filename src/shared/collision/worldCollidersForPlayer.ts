/**
 * Selects static world colliders for horizontal movement / resolve passes based on
 * simulated jump height. Airborne players ignore non-walkable hazards but still
 * collide with props and arena bounds (bounds applied inside `worldCollision` helpers).
 */

import { ARENA_PROP_COLLIDERS, ARENA_WORLD_COLLIDERS } from "../balance-config/arena"
import type { ArenaPropColliderRect } from "./worldCollision"
export { worldCollidersForPlayerState } from "./terrainHazards"

/**
 * Returns the rectangle list used for player world collision given authoritative jump height.
 *
 * @param jumpZ - Simulated vertical offset in world pixels; grounded callers pass `0`.
 * @returns Full colliders when grounded; props-only when airborne (`jumpZ > 0`).
 */
export function worldCollidersForJumpZ(jumpZ: number): readonly ArenaPropColliderRect[] {
  return jumpZ > 0 ? ARENA_PROP_COLLIDERS : ARENA_WORLD_COLLIDERS
}
