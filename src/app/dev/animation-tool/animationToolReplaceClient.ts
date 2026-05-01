import { LADY_WIZARD_FRAME_SIZE_PX } from "@/shared/sprites/ladyWizard"

/** Matches server `MAX_BYTES` for replace-sheet uploads. */
export const LADY_WIZARD_REPLACE_MAX_FILE_BYTES = 10 * 1024 * 1024

const FRAME_PX = LADY_WIZARD_FRAME_SIZE_PX

/**
 * Stable key for per-direction strip cache-bust state in the animation tool UI.
 *
 * @param atlasClipId - Atlas clip id (kebab-case folder segment).
 * @param direction - Compass direction string.
 */
export function replaceStripCacheKey(atlasClipId: string, direction: string): string {
  return `${atlasClipId}:${direction}`
}

/**
 * Appends a cache-bust query param to a root-relative strip URL for `<img>` reloads.
 *
 * @param stripPath - Path like `/assets/.../walk-east.png`.
 * @param version - Version token from the replace-sheet response (safe ISO filename fragment).
 */
export function withStripCacheBust(stripPath: string, version: string | undefined): string {
  if (!version) return stripPath
  const sep = stripPath.includes("?") ? "&" : "?"
  return `${stripPath}${sep}v=${encodeURIComponent(version)}`
}

export type ValidateReplaceFileResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/**
 * Client-side checks before uploading a replacement strip: PNG-ish file, size cap, and
 * dimensions `expectedFrames × FRAME` by `FRAME` using `createImageBitmap`.
 *
 * @param file - User-selected file from `<input type="file">`.
 * @param expectedFrames - Frame count from atlas for this clip+direction.
 */
export async function validateLadyWizardReplaceFile(
  file: File,
  expectedFrames: number,
): Promise<ValidateReplaceFileResult> {
  if (file.size > LADY_WIZARD_REPLACE_MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `file too large (max ${Math.floor(LADY_WIZARD_REPLACE_MAX_FILE_BYTES / (1024 * 1024))} MB)`,
    }
  }
  const looksPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png")
  if (!looksPng) {
    return { ok: false, message: "expected a PNG file" }
  }

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { ok: false, message: "could not decode image" }
  }

  try {
    const expectedWidth = expectedFrames * FRAME_PX
    if (bitmap.width !== expectedWidth || bitmap.height !== FRAME_PX) {
      return {
        ok: false,
        message: `expected ${expectedWidth}×${FRAME_PX}, got ${bitmap.width}×${bitmap.height}`,
      }
    }
    return { ok: true }
  } finally {
    bitmap.close()
  }
}

/**
 * Increments the animation-tool “replaces since last megasheet rebuild” counter.
 *
 * @param n - Current counter value.
 */
export function bumpReplacesSinceRebuild(n: number): number {
  return n + 1
}

/**
 * Resets the stale-megasheet counter after a successful rebuild.
 */
export function clearReplacesSinceRebuild(): number {
  return 0
}
