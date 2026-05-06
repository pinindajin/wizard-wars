/**
 * Walk footstep cadence markers for the dev animation tool.
 * Spacing matches gameplay: two footstep one-shots per full walk loop (interval = loop length / 2).
 */

/**
 * Returns marker times in ms within one walk loop where footstep one-shots align in gameplay
 * (half-loop spacing: 0, duration/2, … while strictly inside `walkDurationMs`).
 *
 * @param walkDurationMs - Full walk animation loop length from animation config.
 * @returns Sorted marker offsets in ms (typically two entries when duration is positive).
 */
export function walkFootstepCadenceMarkerTimesMs(walkDurationMs: number): readonly number[] {
  if (!Number.isFinite(walkDurationMs) || walkDurationMs <= 0) return []
  const intervalMs = walkDurationMs / 2
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return []
  const out: number[] = []
  for (let t = 0; t < walkDurationMs; t += intervalMs) {
    out.push(Math.floor(t))
  }
  return out
}
