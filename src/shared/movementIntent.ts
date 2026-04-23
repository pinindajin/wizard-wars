/**
 * Boolean movement intent sampled from local input or reconstructed from server state.
 */
export type MoveIntent = {
  readonly up: boolean
  readonly down: boolean
  readonly left: boolean
  readonly right: boolean
}

/**
 * Converts WASD booleans into a normalized direction vector.
 *
 * @param intent - Movement intent booleans.
 * @returns Normalized direction components in world axes.
 */
export function normalizedMoveFromWASD(intent: MoveIntent): { dx: number; dy: number } {
  let dx = 0
  let dy = 0

  if (intent.right) dx += 1
  if (intent.left) dx -= 1
  if (intent.down) dy += 1
  if (intent.up) dy -= 1

  if (dx === 0 && dy === 0) {
    return { dx: 0, dy: 0 }
  }

  const len = Math.sqrt(dx * dx + dy * dy)
  return { dx: dx / len, dy: dy / len }
}

/**
 * Converts a normalized intent vector into a world-space frame step.
 *
 * @param dx - Normalized x direction.
 * @param dy - Normalized y direction.
 * @param speedPxPerSec - Base movement speed in pixels per second.
 * @param deltaSec - Frame or tick delta in seconds.
 * @param speedMultiplier - Additional speed multiplier to apply.
 * @returns World-space step for this frame or tick.
 */
export function worldStepFromIntent(
  dx: number,
  dy: number,
  speedPxPerSec: number,
  deltaSec: number,
  speedMultiplier = 1,
): { x: number; y: number } {
  const distance = speedPxPerSec * deltaSec * speedMultiplier
  return {
    x: dx * distance,
    y: dy * distance,
  }
}
