import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import sharp from "sharp"
import { afterEach, describe, expect, it } from "vitest"

import {
  analyzePixelLabExport,
  buildPixelLabArenaImport,
  scaleTileNearestPng,
} from "./import-pixellab-arena"

const TEMP_DIRS: string[] = []

/**
 * Creates an isolated temporary directory for a fixture export.
 *
 * @returns Temporary directory path.
 */
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ww-pixellab-"))
  TEMP_DIRS.push(dir)
  return dir
}

/**
 * Writes JSON fixture data with stable formatting.
 *
 * @param path - Target file path.
 * @param value - JSON-serializable value.
 */
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

/**
 * Creates a solid-color RGBA tile inside a raw map image buffer.
 *
 * @param image - Raw RGBA map image.
 * @param imageWidth - Map image width in pixels.
 * @param col - Tile column.
 * @param row - Tile row.
 * @param color - RGBA color.
 */
function paintTile(
  image: Buffer,
  imageWidth: number,
  col: number,
  row: number,
  color: readonly [number, number, number, number],
): void {
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const offset = ((row * 32 + y) * imageWidth + col * 32 + x) * 4
      image[offset] = color[0]
      image[offset + 1] = color[1]
      image[offset + 2] = color[2]
      image[offset + 3] = color[3]
    }
  }
}

/**
 * Checks whether a generated collider fully covers an expected rectangle.
 *
 * @param rects - Generated collision rectangles.
 * @param expected - Rectangle that should be blocked.
 * @returns Whether the expected area is covered.
 */
function hasCoveringRect(
  rects: readonly { x: number; y: number; width: number; height: number }[],
  expected: { x: number; y: number; width: number; height: number },
): boolean {
  return rects.some(
    (rect) =>
      rect.x <= expected.x &&
      rect.y <= expected.y &&
      rect.x + rect.width >= expected.x + expected.width &&
      rect.y + rect.height >= expected.y + expected.height,
  )
}

/**
 * Writes a minimal PixelLab export fixture with lava border and safe sand center.
 *
 * @returns Fixture directory path.
 */
async function writeFixtureExport(): Promise<string> {
  const dir = makeTempDir()
  const tilesetsDir = join(dir, "tilesets")
  mkdirSync(tilesetsDir)

  const width = 8
  const height = 8
  const terrainCells: { x: number; y: number; terrainId: number }[] = []
  const raw = Buffer.alloc(width * 32 * height * 32 * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1
      const southTransition = x === 2 && y === 2
      const terrainId = border ? 1 : southTransition ? 3 : 2
      terrainCells.push({ x, y, terrainId })
      paintTile(raw, width * 32, x, y, border ? [220, 38, 38, 255] : [63, 63, 70, 255])
      if (southTransition) {
        for (let py = 16; py < 32; py++) {
          for (let px = 0; px < 32; px++) {
            const offset = ((y * 32 + py) * width * 32 + x * 32 + px) * 4
            raw[offset] = 220
            raw[offset + 1] = 38
            raw[offset + 2] = 38
            raw[offset + 3] = 255
          }
        }
      }
    }
  }

  writeJson(join(dir, "map.json"), {
    engine: "pixellab-map-editor",
    mapConfig: {
      tileSize: 32,
      dimensions: {
        width,
        height,
        pixelWidth: width * 32,
        pixelHeight: height * 32,
      },
      boundingBox: {
        minX: 0,
        minY: 0,
        maxX: width - 1,
        maxY: height - 1,
      },
    },
    terrains: [
      { id: 1, name: "lava lake" },
      { id: 2, name: "dark volcanic sand" },
      { id: 3, name: "lava lake ↔ dark volcanic sand" },
    ],
    tilesets: [
      {
        id: "fixture",
        filename: "fixture.png",
        lowerTerrainId: 1,
        upperTerrainId: 2,
        lowerTerrain: "lava lake",
        upperTerrain: "dark volcanic sand",
      },
    ],
  })
  writeJson(join(dir, "terrain-map.json"), {
    format: "terrain-map",
    defaultTerrain: 1,
    cells: terrainCells,
  })
  writeJson(join(dir, "transition-map.json"), {
    format: "transition-map",
    transitions: [
      {
        x: 1,
        y: 1,
        edges: {
          north: { transitionSize: 1 },
          south: { transitionSize: 1 },
          east: { transitionSize: 1 },
          west: { transitionSize: 1 },
        },
      },
    ],
  })

  await sharp(raw, {
    raw: { width: width * 32, height: height * 32, channels: 4 },
  })
    .png()
    .toFile(join(dir, "map-composite.png"))
  await sharp({
    create: { width: 128, height: 256, channels: 4, background: "#00000000" },
  })
    .png()
    .toFile(join(tilesetsDir, "fixture.png"))

  return dir
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    rmSync(TEMP_DIRS.pop() as string, { recursive: true, force: true })
  }
})

describe("PixelLab arena importer", () => {
  it("detects the map JSON, terrain map, transition map, composite PNG, and tileset PNG", async () => {
    const dir = await writeFixtureExport()
    const files = await analyzePixelLabExport(dir)

    expect(files.mapJson.endsWith("map.json")).toBe(true)
    expect(files.terrainMapJson.endsWith("terrain-map.json")).toBe(true)
    expect(files.transitionMapJson?.endsWith("transition-map.json")).toBe(true)
    expect(files.compositePng.endsWith("map-composite.png")).toBe(true)
    expect(files.tilesetPng?.endsWith("fixture.png")).toBe(true)
  })

  it("fails clearly when no PixelLab map JSON exists", async () => {
    const dir = makeTempDir()
    await expect(analyzePixelLabExport(dir)).rejects.toThrow("PixelLab export map JSON not found")
  })

  it("scales 32px tiles to 64px with nearest-neighbor pixels", async () => {
    const raw = Buffer.alloc(32 * 32 * 4)
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const offset = (y * 32 + x) * 4
        const red = x < 16
        raw[offset] = red ? 255 : 0
        raw[offset + 1] = 0
        raw[offset + 2] = red ? 0 : 255
        raw[offset + 3] = 255
      }
    }
    const input = await sharp(raw, { raw: { width: 32, height: 32, channels: 4 } })
      .png()
      .toBuffer()
    const scaled = await sharp(await scaleTileNearestPng(input))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    expect(scaled.info.width).toBe(64)
    expect(scaled.info.height).toBe(64)
    expect([...scaled.data.subarray((20 * 64 + 20) * 4, (20 * 64 + 20) * 4 + 4)]).toEqual([
      255, 0, 0, 255,
    ])
    expect([...scaled.data.subarray((20 * 64 + 50) * 4, (20 * 64 + 50) * 4 + 4)]).toEqual([
      0, 0, 255, 255,
    ])
  })

  it("preserves existing terrain GIDs and starts PixelLab tiles at GID 17", async () => {
    const dir = await writeFixtureExport()
    const imported = await buildPixelLabArenaImport(dir)

    expect(imported.firstPixelLabGid).toBe(17)
    expect(Math.min(...imported.groundGids)).toBe(17)
    expect(imported.uniqueTiles[0]?.tileIndex).toBe(16)
    expect(imported.uniqueTiles[0]?.gid).toBe(17)
    expect(imported.spawnPoints).toHaveLength(12)
  })

  it("builds lava and transition terrain colliders", async () => {
    const dir = await writeFixtureExport()
    const imported = await buildPixelLabArenaImport(dir)

    expect(imported.terrainColliders).toContainEqual({ x: 0, y: 0, width: 512, height: 64 })
    expect(imported.terrainColliders).toContainEqual({ x: 64, y: 64, width: 64, height: 13 })
    expect(imported.terrainColliders).toContainEqual({ x: 64, y: 96, width: 64, height: 32 })
    expect(hasCoveringRect(imported.terrainColliders, { x: 64, y: 64, width: 13, height: 64 }))
      .toBe(true)
    expect(imported.terrainColliders).toContainEqual({ x: 115, y: 64, width: 13, height: 64 })
    expect(imported.terrainColliders).toContainEqual({ x: 128, y: 160, width: 64, height: 32 })
  })
})
