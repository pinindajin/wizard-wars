/**
 * Fixed-interval footstep timing for local walk SFX (client-side).
 */

/**
 * Advances the walk footstep accumulator by one render frame.
 * At most one footstep fires per call; surplus time carries into `nextAccumMs`.
 *
 * @param accumMs - Milliseconds accumulated toward the next step.
 * @param deltaMs - Frame delta in ms.
 * @param active - Whether light gates allow footsteps (intent + grounded + etc.).
 * @param intervalMs - Repeat interval in ms (half walk loop duration).
 * @returns Next accumulator and whether to play a step this frame.
 */
export function tickWalkFootstepAccumulator(
  accumMs: number,
  deltaMs: number,
  active: boolean,
  intervalMs: number,
): { nextAccumMs: number; fireStep: boolean } {
  if (!active || intervalMs <= 0) {
    return { nextAccumMs: 0, fireStep: false }
  }
  const next = accumMs + deltaMs
  if (next >= intervalMs) {
    return { nextAccumMs: next - intervalMs, fireStep: true }
  }
  return { nextAccumMs: next, fireStep: false }
}
