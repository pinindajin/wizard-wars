/**
 * Shared swing-cone geometry for primary melee (and any future arc attacks).
 */
import {
  normalizeAngleDiff,
  pointInSwingCone,
  swingConeIntersectsRect,
  type CharacterHitboxRect,
} from "../../../shared/collision/characterHitbox"

export { normalizeAngleDiff }

/**
 * Returns true if point (px,py) is within the swing cone at (ox,oy) with
 * facing `facingAngle`, radius `radiusPx`, and full arc width `arcDeg`.
 */
export function inSwingCone(
  ox: number,
  oy: number,
  facingAngle: number,
  px: number,
  py: number,
  radiusPx: number,
  arcDeg: number,
): boolean {
  return pointInSwingCone(ox, oy, facingAngle, px, py, radiusPx, arcDeg)
}

/**
 * Returns true if a melee swing cone intersects the character combat hitbox.
 *
 * @param ox - Swing origin x in world pixels.
 * @param oy - Swing origin y in world pixels.
 * @param facingAngle - Swing facing angle in radians.
 * @param radiusPx - Swing radius in world pixels.
 * @param arcDeg - Full swing arc in degrees.
 * @param hitbox - Character hitbox rectangle in world pixels.
 * @returns Whether the cone intersects the hitbox.
 */
export function swingConeIntersectsCharacterHitbox(
  ox: number,
  oy: number,
  facingAngle: number,
  radiusPx: number,
  arcDeg: number,
  hitbox: CharacterHitboxRect,
): boolean {
  return swingConeIntersectsRect(ox, oy, facingAngle, radiusPx, arcDeg, hitbox)
}
