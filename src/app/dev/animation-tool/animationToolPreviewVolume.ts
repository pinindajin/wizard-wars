/** `localStorage` key for animation-tool SFX preview loudness (0–100). */
export const ANIMATION_TOOL_SFX_PREVIEW_VOLUME_LS = "wizard-wars.animation-tool.sfxPreviewVolume"

const DEFAULT_PERCENT = 85

/**
 * Clamps a preview volume percentage to 0–100 inclusive.
 *
 * @param n - Raw value (may be NaN).
 * @returns Integer 0–100.
 */
export function clampPreviewVolumePercent(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PERCENT
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * Maps 0–100 preview percent to `HTMLAudioElement.volume` 0–1.
 *
 * @param percent - Slider value 0–100.
 */
export function previewVolumePercentToAudioVolume(percent: number): number {
  return clampPreviewVolumePercent(percent) / 100
}

/**
 * Parses stored `localStorage` value; returns default when missing or invalid.
 *
 * @param raw - String from `localStorage` or `null`.
 */
export function parseStoredPreviewVolumePercent(raw: string | null): number {
  if (raw == null || raw === "") return DEFAULT_PERCENT
  const n = Number(raw)
  return clampPreviewVolumePercent(n)
}
