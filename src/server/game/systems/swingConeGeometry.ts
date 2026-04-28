/**
 * Shared swing-cone geometry for primary melee (and any future arc attacks).
 */

/** Normalizes `angleA - angleB` to (-π, π]. */
export function normalizeAngleDiff(diff: number): number {
  let d = diff
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

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
  const halfArcRad = ((arcDeg / 2) * Math.PI) / 180
  const dx = px - ox
  const dy = py - oy
  const distSq = dx * dx + dy * dy
  if (distSq > radiusPx * radiusPx) return false
  const angle = Math.atan2(dy, dx)
  const diff = normalizeAngleDiff(angle - facingAngle)
  return Math.abs(diff) <= halfArcRad
}
