import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

/**
 * Default archive root when `WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR` is unset or invalid.
 * Matches animation-tool grill decision: `~/Personal/Development/archive`.
 */
export const DEFAULT_SFX_ARCHIVE_ROOT = join(homedir(), "Personal", "Development", "archive")

/**
 * Resolves the directory used to store replaced SFX files before overwrite.
 * Uses `WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR` when it is a non-empty **absolute** path string;
 * otherwise falls back to {@link DEFAULT_SFX_ARCHIVE_ROOT}.
 *
 * @returns Absolute filesystem path of the archive root (no trailing slash semantics enforced).
 */
export function resolveSfxArchiveRoot(): string {
  const raw = process.env.WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR?.trim()
  if (!raw) return DEFAULT_SFX_ARCHIVE_ROOT
  if (!isAbsolute(raw)) return DEFAULT_SFX_ARCHIVE_ROOT
  return resolve(raw)
}

/**
 * Builds the dated subdirectory path segment `wizard-wars/sfx/YYYY-MM-DD` under an archive root.
 *
 * @param archiveRoot - Absolute archive root from {@link resolveSfxArchiveRoot}.
 * @param now - Clock source for tests.
 */
export function sfxArchiveDayDir(archiveRoot: string, now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return join(archiveRoot, "wizard-wars", "sfx", `${y}-${m}-${d}`)
}

/**
 * Filesystem-safe ISO timestamp for archive filenames.
 *
 * @param d - Instant to format.
 */
export function safeArchiveTimestamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-")
}
