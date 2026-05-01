import { existsSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"
import sharp from "sharp"

import {
  LADY_WIZARD_ATLAS_CLIP_IDS,
  LADY_WIZARD_DIRECTIONS,
  LADY_WIZARD_FRAME_SIZE_PX,
  ladyWizardAnimationsArchiveFsDir,
  ladyWizardAnimationsFramesFsDir,
  ladyWizardAtlasFsPath,
  ladyWizardSheetsArchiveFsDir,
  ladyWizardStripFsPath,
} from "@/shared/sprites/ladyWizard"

export const runtime = "nodejs"

const MAX_BYTES = 10 * 1024 * 1024
const FRAME = LADY_WIZARD_FRAME_SIZE_PX

type AtlasJson = {
  frameSize: number
  clips: Record<string, Record<string, number>>
}

type ErrExtra = Record<string, unknown>

/** Safe timestamp for archive filenames (filesystem-friendly). */
function safeIso(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-")
}

function err(code: string, message: string, status = 400, extra: ErrExtra = {}): NextResponse {
  return NextResponse.json({ ok: false, code, message, ...extra }, { status })
}

/**
 * Dev-only: replace one lady-wizard horizontal strip PNG and re-slice per-frame PNGs.
 *
 * Order: validate → slice upload into a temp frames dir (no live mutation) → swap strip
 * → swap frames. This keeps validation failures and slice failures from touching committed art.
 *
 * @param request - Multipart body with `atlasClipId`, `direction`, `file`.
 * @returns JSON including `version` for cache-busting the strip URL.
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

  const atlasClipId = String(form.get("atlasClipId") ?? "")
  const direction = String(form.get("direction") ?? "")
  const file = form.get("file")

  if (!(LADY_WIZARD_ATLAS_CLIP_IDS as readonly string[]).includes(atlasClipId)) {
    return err("validation_failed", `unknown atlasClipId: ${atlasClipId}`)
  }
  if (!(LADY_WIZARD_DIRECTIONS as readonly string[]).includes(direction)) {
    return err("validation_failed", `unknown direction: ${direction}`)
  }
  if (!(file instanceof File)) {
    return err("validation_failed", "missing file field")
  }
  if (file.size > MAX_BYTES) {
    return err("validation_failed", `file too large (${file.size} > ${MAX_BYTES})`)
  }

  const atlasPath = ladyWizardAtlasFsPath()
  let atlas: AtlasJson
  try {
    atlas = JSON.parse(await readFile(atlasPath, "utf8")) as AtlasJson
  } catch (e) {
    return err(
      "validation_failed",
      `failed to read atlas: ${(e as Error).message}`,
      500,
    )
  }
  const expectedFrames = atlas.clips[atlasClipId]?.[direction]
  if (expectedFrames == null) {
    return err(
      "validation_failed",
      `no atlas entry for ${atlasClipId}/${direction} — add via source-frame pipeline first`,
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  let meta: sharp.Metadata
  try {
    meta = await sharp(buffer).metadata()
  } catch {
    return err("validation_failed", "could not decode image")
  }
  if (meta.format !== "png") {
    return err("validation_failed", `expected png, got ${meta.format ?? "unknown"}`)
  }
  const expectedWidth = expectedFrames * FRAME
  if (meta.width !== expectedWidth || meta.height !== FRAME) {
    return err(
      "validation_failed",
      `expected ${expectedWidth}×${FRAME}, got ${meta.width ?? "?"}×${meta.height ?? "?"}`,
    )
  }

  const liveStripPath = ladyWizardStripFsPath(atlasClipId, direction)
  const sheetsArchiveDir = ladyWizardSheetsArchiveFsDir()
  const framesLiveDir = ladyWizardAnimationsFramesFsDir(atlasClipId, direction)
  const framesArchiveRoot = ladyWizardAnimationsArchiveFsDir(atlasClipId)

  const ts = safeIso(new Date())
  const stripArchivePath = join(sheetsArchiveDir, `${atlasClipId}-${direction}-${ts}.png`)
  const framesArchivePath = join(framesArchiveRoot, `${direction}-${ts}`)
  const stripTmpPath = `${liveStripPath}.tmp.${randomUUID()}`
  const framesTmpDir = `${framesLiveDir}.tmp.${randomUUID()}`

  await mkdir(sheetsArchiveDir, { recursive: true })
  await mkdir(dirname(liveStripPath), { recursive: true })
  await mkdir(framesArchiveRoot, { recursive: true })
  await mkdir(dirname(framesLiveDir), { recursive: true })

  // 1) Slice into temp dir only — live strip and live frames untouched on failure.
  try {
    await mkdir(framesTmpDir, { recursive: true })
    for (let i = 0; i < expectedFrames; i++) {
      const out = join(framesTmpDir, `frame_${String(i).padStart(3, "0")}.png`)
      await sharp(buffer)
        .extract({ left: i * FRAME, top: 0, width: FRAME, height: FRAME })
        .png()
        .toFile(out)
    }
  } catch (e) {
    await rm(framesTmpDir, { recursive: true, force: true })
    return err(
      "frame_slice_failed",
      `slice failed: ${(e as Error).message}`,
      500,
      { recovery: { run: [`rm -rf ${framesTmpDir}`] } },
    )
  }

  // 2) Atomic strip swap
  try {
    await writeFile(stripTmpPath, buffer)
  } catch (e) {
    await rm(framesTmpDir, { recursive: true, force: true })
    return err(
      "stage_write_failed",
      `tmp write failed: ${(e as Error).message}`,
      500,
      { recovery: { run: [`rm ${stripTmpPath}`, `rm -rf ${framesTmpDir}`] } },
    )
  }

  let stripArchived = false
  if (existsSync(liveStripPath)) {
    try {
      await rename(liveStripPath, stripArchivePath)
      stripArchived = true
    } catch (e) {
      await rm(stripTmpPath, { force: true })
      await rm(framesTmpDir, { recursive: true, force: true })
      return err(
        "archive_rename_failed",
        `archive failed: ${(e as Error).message}`,
        500,
        { recovery: { run: [`rm ${stripTmpPath}`, `rm -rf ${framesTmpDir}`] } },
      )
    }
  }

  try {
    await rename(stripTmpPath, liveStripPath)
  } catch (e) {
    await rm(stripTmpPath, { force: true })
    await rm(framesTmpDir, { recursive: true, force: true })
    if (stripArchived) {
      try {
        await rename(stripArchivePath, liveStripPath)
      } catch {
        /* best-effort; recovery lists manual mv */
      }
    }
    return err(
      "commit_rename_failed",
      `live install failed: ${(e as Error).message}`,
      500,
      {
        recovery: stripArchived
          ? {
              run: [
                `rm -f ${liveStripPath}`,
                `mv ${stripArchivePath} ${liveStripPath}`,
                `rm -rf ${framesTmpDir}`,
              ],
            }
          : { run: [`rm -f ${stripTmpPath}`, `rm -rf ${framesTmpDir}`] },
        livePath: liveStripPath,
        archivePath: stripArchived ? stripArchivePath : null,
      },
    )
  }

  // 3) Frames swap (strip is live; if we fail, restore prior strip from archive when possible)
  let framesArchived = false
  if (existsSync(framesLiveDir)) {
    try {
      await rename(framesLiveDir, framesArchivePath)
      framesArchived = true
    } catch (e) {
      await rm(framesTmpDir, { recursive: true, force: true })
      const restoreStrip: string[] = stripArchived
        ? [`rm -f ${liveStripPath}`, `mv ${stripArchivePath} ${liveStripPath}`]
        : [`rm -f ${liveStripPath}`]
      return err(
        "archive_rename_failed",
        `frames archive failed: ${(e as Error).message}`,
        500,
        {
          recovery: { run: restoreStrip },
          liveStripPath,
          stripArchivePath: stripArchived ? stripArchivePath : null,
        },
      )
    }
  }

  try {
    await rename(framesTmpDir, framesLiveDir)
  } catch (e) {
    const restoreFrames: string[] = framesArchived
      ? [`rm -rf ${framesLiveDir}`, `mv ${framesArchivePath} ${framesLiveDir}`]
      : [`rm -rf ${framesTmpDir}`]

    const restoreStrip: string[] = stripArchived
      ? [`rm -f ${liveStripPath}`, `mv ${stripArchivePath} ${liveStripPath}`]
      : []

    return err(
      "commit_rename_failed",
      `frames install failed: ${(e as Error).message}`,
      500,
      {
        recovery: { run: [...restoreStrip, ...restoreFrames] },
        framesTmpDir,
        framesArchivePath: framesArchived ? framesArchivePath : null,
      },
    )
  }

  console.log(
    `[replace-sheet] clip=${atlasClipId} dir=${direction} stripArchived=${stripArchived} framesArchived=${framesArchived} frames=${expectedFrames}`,
  )

  return NextResponse.json({
    ok: true,
    savedAt: new Date().toISOString(),
    version: ts,
    stripPublicPath: `/assets/sprites/heroes/lady-wizard/sheets/${atlasClipId}-${direction}.png`,
    stripArchivePath: stripArchived ? stripArchivePath : null,
    framesArchivePath: framesArchived ? framesArchivePath : null,
    frameCount: expectedFrames,
  })
}
