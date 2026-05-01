/**
 * Selects static world colliders for horizontal movement / resolve passes based on
 * simulated jump height. Airborne players ignore non-walkable hazards but still
 * collide with props and arena bounds (bounds applied inside `worldCollision` helpers).
 */

import { ARENA_PROP_COLLIDERS, ARENA_WORLD_COLLIDERS } from "../balance-config/arena"
import { JUMP_AIRBORNE_COLLIDER_EPSILON_PX } from "../balance-config/combat"
import type { ArenaPropColliderRect } from "./worldCollision"

/**
 * Returns the rectangle list used for player world collision given authoritative jump height.
 *
 * @param jumpZ - Simulated vertical offset in world pixels; grounded callers pass `0`.
 * @returns Full colliders when grounded; props-only when sufficiently airborne.
 */
export function worldCollidersForJumpZ(jumpZ: number): readonly ArenaPropColliderRect[] {
  return jumpZ > JUMP_AIRBORNE_COLLIDER_EPSILON_PX
    ? ARENA_PROP_COLLIDERS
    : ARENA_WORLD_COLLIDERS
}