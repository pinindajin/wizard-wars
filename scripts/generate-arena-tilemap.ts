/**
 * Generates a 21×12 arena tilemap JSON for Phaser's Tilemap loader.
 * Uses the terrain tiles from arena-terrain.png (16 tiles, each 64×64).
 * Tile indices (0-indexed):
 *   0 = packed dirt arena floor
 *   1 = green grass
 *   2 = mossy stone floor
 *   3 = dark rocky cliff texture
 *   4 = shallow water
 *   5 = sandy dirt alternate
 *   6 = dark earth with roots
 *   7 = ancient stone cobblestone
 *
 * Arena layout:
 *   - Row 0 and 11: cliff edge (tile 3) = impassable boundary
 *   - Col 0 and 20: cliff edge (tile 3) = impassable boundary
 *   - Inner area: mix of floor tiles for visual variety
 *   - Central zone: mossy stone (tile 2) for the arena floor
 */

import { resolve } from "node:path"
import { writeFileSync } from "node:fs"

const COLS = 21
const ROWS = 12
const TILE_SIZE = 64
const TILESET_NAME = "arena-terrain"
const TILESET_IMAGE = "../tilesets/arena-terrain.png"

// Tile indices
const CLIFF = 3
const DIRT = 0
const GRASS = 1
const STONE = 2
const WATER = 4
const SANDY = 5
const DARK_EARTH = 6
const COBBLE = 7

/**
 * Builds a 21×12 tile data array for the arena floor.
 * Edge tiles are cliff/grass, interior is mostly dirt with stone center.
 *
 * @returns Flat array of tile GIDs (1-indexed for Phaser, 0 = empty).
 */
function buildTileData(): number[] {
  const data: number[] = []

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let tileIdx: number

      // Border (row 0, row 11, col 0, col 20) → cliff
      if (row === 0 || row === ROWS - 1 || col === 0 || col === COLS - 1) {
        tileIdx = CLIFF
      }
      // Grass strip just inside border
      else if (row === 1 || row === ROWS - 2 || col === 1 || col === COLS - 2) {
        tileIdx = GRASS
      }
      // Center area (cols 8-12, rows 4-7) → cobblestone for the arena center
      else if (col >= 8 && col <= 12 && row >= 4 && row <= 7) {
        tileIdx = COBBLE
      }
      // Quadrant variation
      else {
        const quadrant = (row < ROWS / 2 ? 0 : 2) + (col < COLS / 2 ? 0 : 1)
        const variation = (row * 7 + col * 3) % 5
        const quadrantTiles = [
          [DIRT, DIRT, SANDY, DIRT, DARK_EARTH],
          [SANDY, DIRT, DIRT, DARK_EARTH, DIRT],
          [DIRT, DARK_EARTH, DIRT, SANDY, DIRT],
          [STONE, DIRT, DIRT, STONE, SANDY],
        ]
        tileIdx = quadrantTiles[quadrant][variation]
      }

      // Phaser expects 1-indexed GIDs (0 = empty cell)
      data.push(tileIdx + 1)
    }
  }

  return data
}

/**
 * Main: writes the arena.json tilemap to public/assets/tilemaps/arena.json.
 */
function main(): void {
  const tileData = buildTileData()

  const tilemap = {
    width: COLS,
    height: ROWS,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    orientation: "orthogonal",
    renderorder: "right-down",
    version: "1.10",
    tiledversion: "1.10.2",
    infinite: false,
    nextlayerid: 3,
    nextobjectid: 100,
    tilesets: [
      {
        firstgid: 1,
        source: TILESET_IMAGE,
        name: TILESET_NAME,
        tilewidth: TILE_SIZE,
        tileheight: TILE_SIZE,
        spacing: 0,
        margin: 0,
        columns: 16,
        tilecount: 16,
        image: TILESET_IMAGE,
        imagewidth: TILE_SIZE * 16,
        imageheight: TILE_SIZE,
      },
    ],
    layers: [
      {
        id: 1,
        name: "Ground",
        type: "tilelayer",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width: COLS,
        height: ROWS,
        data: tileData,
      },
      {
        id: 2,
        name: "SpawnPoints",
        type: "objectgroup",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        draworder: "topdown",
        objects: generateSpawnPointObjects(),
      },
    ],
  }

  const outputPath = resolve(process.cwd(), "public/assets/tilemaps/arena.json")
  writeFileSync(outputPath, JSON.stringify(tilemap, null, 2))
  console.log(`✅ arena.json written (${COLS}×${ROWS} tiles, ${generateSpawnPointObjects().length} spawn points)`)
}

/**
 * Generates Tiled-compatible object records for the 12 spawn points on the spawn ring.
 *
 * @returns Array of Tiled object descriptors with spawn-point-N labels.
 */
function generateSpawnPointObjects(): object[] {
  const CENTER_X = (COLS * TILE_SIZE) / 2  // 672
  const CENTER_Y = (ROWS * TILE_SIZE) / 2  // 384
  const RADIUS = 300
  const COUNT = 12

  return Array.from({ length: COUNT }, (_, i) => {
    const angleDeg = i * 30
    const angleRad = (angleDeg * Math.PI) / 180
    const x = Math.round(CENTER_X + RADIUS * Math.cos(angleRad))
    const y = Math.round(CENTER_Y + RADIUS * Math.sin(angleRad))
    return {
      id: i + 1,
      name: `spawn-point-${i}`,
      type: "spawn-point",
      x,
      y,
      width: 0,
      height: 0,
      visible: true,
      properties: [
        { name: "spawnIndex", type: "int", value: i },
      ],
    }
  })
}

main()
