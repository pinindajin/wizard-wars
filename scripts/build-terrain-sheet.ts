/**
 * Assembles individual terrain tiles into a single horizontal strip sprite sheet
 * for use with Phaser's tilemap system.
 * Output: public/assets/tilesets/arena-terrain.png (all 16 tiles in a row)
 */

import { resolve } from "node:path"
import { readdirSync, existsSync } from "node:fs"
import sharp from "sharp"

const TILE_SIZE = 64
const TERRAIN_DIR = resolve(process.cwd(), "public/assets/tilesets/terrain-source")
const OUTPUT_PATH = resolve(process.cwd(), "public/assets/tilesets/arena-terrain.png")

/**
 * Builds the arena terrain sprite sheet from individual tiles.
 * Arranges all tiles horizontally in one row for Phaser tilemap compatibility.
 */
async function buildTerrainSheet(): Promise<void> {
  const tilePaths = readdirSync(TERRAIN_DIR)
    .filter((f) => f.endsWith(".png"))
    .sort((a, b) => {
      const aNum = parseInt(a.replace("tile_", "").replace(".png", ""), 10)
      const bNum = parseInt(b.replace("tile_", "").replace(".png", ""), 10)
      return aNum - bNum
    })
    .map((f) => resolve(TERRAIN_DIR, f))

  console.log(`Building sheet from ${tilePaths.length} tiles...`)

  const width = TILE_SIZE * tilePaths.length
  const height = TILE_SIZE

  const compositeInputs = tilePaths.map((tilePath, i) => ({
    input: tilePath,
    left: i * TILE_SIZE,
    top: 0,
  }))

  await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(compositeInputs)
    .png()
    .toFile(OUTPUT_PATH)

  console.log(`✅ arena-terrain.png written (${tilePaths.length} tiles × 64px = ${width}×${height})`)
}

void buildTerrainSheet().catch(console.error)
