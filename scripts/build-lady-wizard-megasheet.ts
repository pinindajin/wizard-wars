/**
 * Stitches per-clip, per-direction strip PNGs into a single Phaser spritesheet
 * that matches `src/game/animation/LadyWizardAnimDefs.ts` and
 * `public/.../sheets/atlas.json`.
 *
 * Prerequisite: `bunx tsx scripts/build-lady-wizard-sheets.ts`
 * Output: `public/assets/sprites/heroes/lady-wizard/sheets/lady-wizard-megasheet.png`
 */

import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import sharp from "sharp"

const SHEETS_DIR = resolve(
  process.cwd(),
  "public/assets/sprites/heroes/lady-wizard/sheets",
)
const OUTPUT = join(SHEETS_DIR, "lady-wizard-megasheet.png")

const FRAME = 124
const DIRECTIONS = [
  "south",
  "south-east",
  "east",
  "north-east",
  "north",
  "north-west",
  "west",
  "south-west",
] as const

/** Same as `CLIP_FRAMES` in LadyWizardAnimDefs. */
const CLIP_FRAMES: Record<string, number> = {
  breathing_idle: 4,
  walk: 15,
  death: 17,
  light_spell_cast: 17,
  heavy_spell_cast: 17,
  summoned_axe_swing: 17,
}

/** Same as `CLIP_BASE_FRAME` in LadyWizardAnimDefs. */
const CLIP_BASE_FRAME: Record<string, number> = {
  breathing_idle: 0,
  walk: 4,
  death: 19,
  light_spell_cast: 36,
  heavy_spell_cast: 53,
  summoned_axe_swing: 70,
}

const CLIP_TO_SHEET_PREFIX: Record<string, string> = {
  breathing_idle: "idle",
  walk: "walk",
  death: "death",
  light_spell_cast: "light-spell-cast",
  heavy_spell_cast: "heavy-spell-cast",
  summoned_axe_swing: "summoned-axe-attack",
}

const FRAMES_PER_ROW =
  CLIP_BASE_FRAME.summoned_axe_swing + CLIP_FRAMES.summoned_axe_swing

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
  if (FRAMES_PER_ROW !== 87) {
    throw new Error(`Layout drift: expected 87 columns, got ${FRAMES_PER_ROW}`)
  }

  const width = FRAMES_PER_ROW * FRAME
  const height = DIRECTIONS.length * FRAME
  const layers: { input: Buffer; left: number; top: number }[] = []

  for (let row = 0; row < DIRECTIONS.length; row++) {
    const direction = DIRECTIONS[row]!
    const y = row * FRAME

    for (const clip of Object.keys(CLIP_FRAMES) as (keyof typeof CLIP_FRAMES)[]) {
      const prefix = CLIP_TO_SHEET_PREFIX[clip]
      const slotW = CLIP_FRAMES[clip] * FRAME
      const x = CLIP_BASE_FRAME[clip] * FRAME
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
          throw new Error(
            `Strip too wide for slot (${clip} ${direction}): ${meta.width} > ${slotW}`,
          )
        }
        if (meta.width === slotW) {
          input = raw
        } else {
          const pad = await makeTransparentStrip(CLIP_FRAMES[clip])
          input = await sharp(pad)
            .composite([{ input: raw, left: 0, top: 0 }])
            .png()
            .toBuffer()
        }
      } else {
        input = await makeTransparentStrip(CLIP_FRAMES[clip])
        console.warn(`⚠ Missing ${filePath} — using transparent ${CLIP_FRAMES[clip]} frame slot`)
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

  console.log(`✅ Wrote ${OUTPUT} (${width}×${height}, ${FRAMES_PER_ROW} frames/row)`)
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
