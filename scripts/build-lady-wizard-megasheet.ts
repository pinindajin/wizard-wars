/**
 * Stitches per-clip, per-direction strip PNGs into a single Phaser spritesheet
 * that matches `src/shared/sprites/ladyWizard.ts` / `LadyWizardAnimDefs.ts` and
 * `public/.../sheets/atlas.json`.
 *
 * Prerequisite: `bunx tsx scripts/build-lady-wizard-sheets.ts`
 * Output: `public/assets/sprites/heroes/lady-wizard/sheets/lady-wizard-megasheet.png`
 */

import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import sharp from "sharp"

import {
  LADY_WIZARD_CLIP_BASE_FRAME,
  LADY_WIZARD_CLIP_FRAMES,
  LADY_WIZARD_CLIP_TO_SHEET_PREFIX,
  LADY_WIZARD_FRAME_SIZE_PX,
  LADY_WIZARD_FRAMES_PER_DIRECTION_ROW,
  LADY_WIZARD_MEGASHEET_CLIP_ORDER,
  LADY_WIZARD_DIRECTIONS,
} from "../src/shared/sprites/ladyWizard"

const DEFAULT_SHEETS_DIR = resolve(
  process.cwd(),
  "public/assets/sprites/heroes/lady-wizard/sheets",
)

const FRAME = LADY_WIZARD_FRAME_SIZE_PX
const DIRECTIONS = LADY_WIZARD_DIRECTIONS

async function makeTransparentStrip(slotFrames: number): Promise<Buffer> {
  return sharp({
    create: {
      width: slotFrames * FRAME,
      height: FRAME,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer()
}

export type BuildLadyWizardMegasheetOptions = {
  readonly sheetsDir?: string
  readonly silent?: boolean
}

export type BuildLadyWizardMegasheetResult = {
  readonly outputPath: string
  readonly width: number
  readonly height: number
  readonly framesPerRow: number
}

/**
 * Composites the lady-wizard megasheet from per-clip strips.
 * Exported so dev-only API endpoints can trigger rebuild without spawning a CLI.
 */
export async function buildLadyWizardMegasheet(
  options: BuildLadyWizardMegasheetOptions = {},
): Promise<BuildLadyWizardMegasheetResult> {
  const sheetsDir = options.sheetsDir ?? DEFAULT_SHEETS_DIR
  const output = join(sheetsDir, "lady-wizard-megasheet.png")
  const log = options.silent ? () => {} : console.log
  const warn = options.silent ? () => {} : console.warn

  if (LADY_WIZARD_FRAMES_PER_DIRECTION_ROW !== 104) {
    throw new Error(
      `Layout drift: expected 104 columns, got ${LADY_WIZARD_FRAMES_PER_DIRECTION_ROW}`,
    )
  }

  const width = LADY_WIZARD_FRAMES_PER_DIRECTION_ROW * FRAME
  const height = DIRECTIONS.length * FRAME
  const layers: { input: Buffer; left: number; top: number }[] = []

  for (let row = 0; row < DIRECTIONS.length; row++) {
    const direction = DIRECTIONS[row]!
    const y = row * FRAME

    for (const clip of LADY_WIZARD_MEGASHEET_CLIP_ORDER) {
      const prefix = LADY_WIZARD_CLIP_TO_SHEET_PREFIX[clip]
      const slotW = LADY_WIZARD_CLIP_FRAMES[clip] * FRAME
      const x = LADY_WIZARD_CLIP_BASE_FRAME[clip] * FRAME
      const filePath = join(sheetsDir, `${prefix}-${direction}.png`)

      let input: Buffer
      if (existsSync(filePath)) {
        const raw = await sharp(filePath).png().toBuffer()
        const meta = await sharp(raw).metadata()
        if (meta.width === undefined || meta.height === undefined) {
          throw new Error(`No size for ${filePath}`)
        }
        if (meta.height !== FRAME) {
          throw new Error(`Expected height ${FRAME} for ${filePath}, got ${meta.height}`)
        }
        if (meta.width > slotW) {
          throw new Error(`Strip too wide for slot (${String(clip)} ${direction}): ${meta.width} > ${slotW}`)
        }
        if (meta.width === slotW) {
          input = raw
        } else {
          const pad = await makeTransparentStrip(LADY_WIZARD_CLIP_FRAMES[clip])
          input = await sharp(pad)
            .composite([{ input: raw, left: 0, top: 0 }])
            .png()
            .toBuffer()
        }
      } else {
        input = await makeTransparentStrip(LADY_WIZARD_CLIP_FRAMES[clip])
        warn(
          `⚠ Missing ${filePath} — using transparent ${LADY_WIZARD_CLIP_FRAMES[clip]} frame slot`,
        )
      }

      layers.push({ input, left: x, top: y })
    }
  }

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png()
    .toFile(output)

  log(
    `✅ Wrote ${output} (${width}×${height}, ${LADY_WIZARD_FRAMES_PER_DIRECTION_ROW} frames/row)`,
  )

  return {
    outputPath: output,
    width,
    height,
    framesPerRow: LADY_WIZARD_FRAMES_PER_DIRECTION_ROW,
  }
}

const isCliEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /build-lady-wizard-megasheet\.(ts|js|mjs|cjs)$/.test(process.argv[1])

if (isCliEntry) {
  void buildLadyWizardMegasheet().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
