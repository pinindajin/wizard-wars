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

const SHEETS_DIR = resolve(
  process.cwd(),
  "public/assets/sprites/heroes/lady-wizard/sheets",
)
const OUTPUT = join(SHEETS_DIR, "lady-wizard-megasheet.png")

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

async function main(): Promise<void> {
  if (LADY_WIZARD_FRAMES_PER_DIRECTION_ROW !== 87) {
    throw new Error(
      `Layout drift: expected 87 columns, got ${LADY_WIZARD_FRAMES_PER_DIRECTION_ROW}`,
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
      const filePath = join(SHEETS_DIR, `${prefix}-${direction}.png`)

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
        console.warn(
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
    .toFile(OUTPUT)

  console.log(
    `✅ Wrote ${OUTPUT} (${width}×${height}, ${LADY_WIZARD_FRAMES_PER_DIRECTION_ROW} frames/row)`,
  )
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
