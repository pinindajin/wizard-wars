import { existsSync } from "node:fs"
import { copyFile, mkdir, rename, unlink, writeFile } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"

import { NextResponse } from "next/server"

import {
  resolveSfxArchiveRoot,
  safeArchiveTimestamp,
  sfxArchiveDayDir,
} from "@/server/dev/animationToolSfxArchive"
import type { AnimationActionId } from "@/shared/balance-config/animationConfig"
import { resolveSfxKeyForAction } from "@/shared/balance-config/animationToolSfx"
import { VALID_HERO_IDS } from "@/shared/balance-config/heroes"

export const runtime = "nodejs"

const MAX_BYTES = 10 * 1024 * 1024

type ErrBody = { ok: false; code: string; message: string }

/**
 * JSON error helper for dev-only import route.
 *
 * @param code - Stable machine-readable code.
 * @param message - Human-readable detail.
 * @param status - HTTP status.
 */
function err(code: string, message: string, status = 400): NextResponse<ErrBody> {
  return NextResponse.json({ ok: false, code, message }, { status })
}

/**
 * Validates Phaser SFX cache keys used in `public/assets/sounds/*.mp3`.
 *
 * @param key - Candidate key (no extension).
 */
function isValidSfxKey(key: string): boolean {
  return /^[a-z][a-z0-9_-]*$/.test(key)
}

/**
 * Ensures `child` resolves to a path inside `parent` (prevents `..` escapes).
 *
 * @param parent - Trusted directory (resolved).
 * @param child - Candidate file path (resolved).
 */
function isInsideDirectory(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

/**
 * Moves `livePath` into the dated archive tree; tries `rename`, then copy+unlink on `EXDEV`.
 *
 * @param livePath - Current committed SFX path under `public/assets/sounds/`.
 * @param sfxKey - Phaser key (filename stem).
 * @param now - Clock for archive folder and filename.
 */
async function archiveExistingIfPresent(livePath: string, sfxKey: string, now: Date): Promise<void> {
  if (!existsSync(livePath)) return
  const root = resolveSfxArchiveRoot()
  const dir = sfxArchiveDayDir(root, now)
  await mkdir(dir, { recursive: true })
  const dest = resolve(dir, `${sfxKey}-${safeArchiveTimestamp(now)}.mp3`)
  try {
    await rename(livePath, dest)
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === "EXDEV") {
      await copyFile(livePath, dest)
      await unlink(livePath)
      return
    }
    throw e
  }
}

/**
 * Dev-only: replace one `public/assets/sounds/<resolved>.mp3` from multipart upload.
 * Archives any existing file to `WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR` (see `animationToolSfxArchive.ts`).
 *
 * @param request - Multipart body: `file`, `heroId`, `actionId`, `confirmReplace` === `"true"`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return err("forbidden", "animation tool is dev-only", 403)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err("validation_failed", "expected multipart/form-data body")
  }

  if (String(form.get("confirmReplace") ?? "") !== "true") {
    return err("validation_failed", "confirmReplace must be the string true")
  }

  const heroId = String(form.get("heroId") ?? "")
  const actionIdRaw = String(form.get("actionId") ?? "")
  const file = form.get("file")

  if (!VALID_HERO_IDS.includes(heroId)) {
    return err("validation_failed", "unknown heroId")
  }

  const actionId = actionIdRaw as AnimationActionId
  const sfxKey = resolveSfxKeyForAction(heroId, actionId)
  if (sfxKey == null || !isValidSfxKey(sfxKey)) {
    return err("validation_failed", "no SFX key mapped for this hero/action")
  }

  if (!(file instanceof File)) {
    return err("validation_failed", "missing file field")
  }

  if (file.size === 0) {
    return err("validation_failed", "empty file")
  }
  if (file.size > MAX_BYTES) {
    return err("validation_failed", `file too large (${String(file.size)} > ${String(MAX_BYTES)})`)
  }

  const lowerName = file.name.toLowerCase()
  if (!lowerName.endsWith(".mp3")) {
    return err("validation_failed", "expected .mp3 extension")
  }
  const mime = file.type.toLowerCase()
  const mimeOk =
    mime === "" || mime.includes("audio/mpeg") || mime.includes("audio/mp3") || mime === "audio/mpeg"
  if (!mimeOk) {
    return err("validation_failed", "expected audio/mpeg or audio/mp3 Content-Type (or empty with .mp3)")
  }

  const cwd = process.cwd()
  const soundsRoot = resolve(cwd, "public", "assets", "sounds")
  const target = resolve(soundsRoot, `${sfxKey}.mp3`)
  if (!isInsideDirectory(soundsRoot, target)) {
    return err("validation_failed", "invalid target path")
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const now = new Date()

  try {
    await archiveExistingIfPresent(target, sfxKey, now)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return err("archive_failed", `could not archive existing file: ${message}`, 500)
  }

  try {
    await writeFile(target, buffer)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return err("write_failed", `could not write sound file: ${message}`, 500)
  }

  return NextResponse.json({
    ok: true,
    sfxKey,
    publicPath: `/assets/sounds/${sfxKey}.mp3`,
  })
}
