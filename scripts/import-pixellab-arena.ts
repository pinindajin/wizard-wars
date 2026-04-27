import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import sharp from "sharp"

import { PLAYER_RADIUS_PX } from "../src/shared/balance-config/combat"
import { buildTerrainSheet } from "./build-terrain-sheet"

export const DEFAULT_PIXELLAB_EXPORT_DIR =
  "/Users/jakemcbride/Downloads/wizard-wars-pixel-lab-export-01"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, "..")
const SOURCE_TILE_SIZE_PX = 32
const TARGET_TILE_SIZE_PX = 64
const EXISTING_TERRAIN_TILE_COUNT = 16
const PIXELLAB_FIRST_GID = EXISTING_TERRAIN_TILE_COUNT + 1
const SPAWN_POINT_COUNT = 12
const TERRAIN_DIR = resolve(ROOT, "public/assets/tilesets/terrain-source")
const ARENA_SCENE = resolve(ROOT, "src/game/scenes/Arena.scene")
const ARENA_TS = resolve(ROOT, "src/game/scenes/Arena.ts")
const GENERATED_LAYOUT = resolve(ROOT, "src/shared/balance-config/generated/arena-layout.ts")

type JsonRecord = Record<string, unknown>

type PixelLabMap = {
  readonly mapConfig: {
    readonly tileSize: number
    readonly dimensions: {
      readonly width: number
      readonly height: number
      readonly pixelWidth: number
      readonly pixelHeight: number
    }
    readonly boundingBox: {
      readonly minX: number
      readonly minY: number
      readonly maxX: number
      readonly maxY: number
    }
  }
  readonly terrains: readonly {
    readonly id: number
    readonly name: string
  }[]
  readonly tilesets: readonly {
    readonly id: string
    readonly filename: string
    readonly lowerTerrainId: number
    readonly upperTerrainId: number
    readonly lowerTerrain: string
    readonly upperTerrain: string
  }[]
}

type TerrainMap = {
  readonly defaultTerrain: number
  readonly cells: readonly {
    readonly x: number
    readonly y: number
    readonly terrainId: number
  }[]
}

type TransitionMap = {
  readonly transitions: readonly {
    readonly x: number
    readonly y: number
    readonly edges: Record<string, TransitionEdge>
  }[]
}

type TransitionEdge = {
  readonly fromTerrain?: string
  readonly toTerrain?: string
  readonly transitionSize?: number
}

type ArenaColliderRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

type ArenaScene = {
  settings?: {
    borderWidth?: number
    borderHeight?: number
  }
  displayList?: JsonRecord[]
  plainObjects?: JsonRecord[]
}

export type PixelLabExportFiles = {
  readonly exportDir: string
  readonly mapJson: string
  readonly terrainMapJson: string
  readonly transitionMapJson: string | null
  readonly compositePng: string
  readonly tilesetPng: string | null
  readonly metadataJson: string | null
}

export type PixelLabArenaImport = {
  readonly cols: number
  readonly rows: number
  readonly tileSize: number
  readonly pixelLabTileCount: number
  readonly firstPixelLabGid: number
  readonly groundGids: readonly number[]
  readonly blockedSpawnTileGids: readonly number[]
  readonly blockedSpawnCells: readonly {
    readonly col: number
    readonly row: number
    readonly gid: number
  }[]
  readonly terrainColliders: readonly ArenaColliderRect[]
  readonly spawnPoints: readonly {
    readonly x: number
    readonly y: number
  }[]
  readonly uniqueTiles: readonly {
    readonly tileIndex: number
    readonly gid: number
    readonly png64: Buffer
  }[]
}

/**
 * Returns true when a value is a plain object record.
 *
 * @param value - Value to inspect.
 * @returns Whether the value can be safely accessed as an object record.
 */
function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

/**
 * Reads a JSON file as a plain object.
 *
 * @param path - Absolute JSON file path.
 * @returns Parsed object.
 */
function readJsonRecord(path: string): JsonRecord {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
  if (!isRecord(parsed)) {
    throw new Error(`Expected JSON object in ${path}`)
  }
  return parsed
}

/**
 * Recursively lists files under a directory up to a small depth.
 *
 * @param dir - Root directory.
 * @param depth - Remaining traversal depth.
 * @returns Absolute file paths.
 */
function listFiles(dir: string, depth = 2): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isFile()) out.push(path)
    else if (entry.isDirectory() && depth > 0) out.push(...listFiles(path, depth - 1))
  }
  return out
}

/**
 * Checks whether a JSON object is the PixelLab map manifest.
 *
 * @param value - Parsed JSON record.
 * @returns Whether this object has the expected map manifest shape.
 */
function isPixelLabMap(value: JsonRecord): value is PixelLabMap {
  const mapConfig = value.mapConfig
  return (
    isRecord(mapConfig) &&
    isRecord(mapConfig.dimensions) &&
    isRecord(mapConfig.boundingBox) &&
    typeof mapConfig.tileSize === "number" &&
    typeof mapConfig.dimensions.width === "number" &&
    typeof mapConfig.dimensions.height === "number" &&
    typeof mapConfig.dimensions.pixelWidth === "number" &&
    typeof mapConfig.dimensions.pixelHeight === "number" &&
    Array.isArray(value.tilesets) &&
    Array.isArray(value.terrains)
  )
}

/**
 * Checks whether a JSON object is the PixelLab terrain map.
 *
 * @param value - Parsed JSON record.
 * @returns Whether this object has terrain cell data.
 */
function isTerrainMap(value: JsonRecord): value is TerrainMap {
  return typeof value.defaultTerrain === "number" && Array.isArray(value.cells)
}

/**
 * Checks whether a JSON object is the PixelLab transition map.
 *
 * @param value - Parsed JSON record.
 * @returns Whether this object has transition edge data.
 */
function isTransitionMap(value: JsonRecord): value is TransitionMap {
  return Array.isArray(value.transitions)
}

/**
 * Checks whether a JSON object looks like PixelLab tile metadata.
 *
 * @param value - Parsed JSON record.
 * @returns Whether the object has tile metadata entries.
 */
function isMetadata(value: JsonRecord): boolean {
  if (Array.isArray(value.tiles)) return true
  if (isRecord(value.tileset_data) && Array.isArray(value.tileset_data.tiles)) return true
  return false
}

/**
 * Reads PNG dimensions with Sharp metadata.
 *
 * @param path - PNG path.
 * @returns Pixel dimensions.
 */
async function readImageDimensions(path: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(path).metadata()
  if (!meta.width || !meta.height) throw new Error(`Could not read PNG dimensions: ${path}`)
  return { width: meta.width, height: meta.height }
}

/**
 * Finds the first JSON file matching a predicate.
 *
 * @param files - Candidate file paths.
 * @param predicate - Shape guard.
 * @returns Matching path and parsed JSON, or null.
 */
function findJson<T extends JsonRecord>(
  files: readonly string[],
  predicate: (value: JsonRecord) => value is T,
): { path: string; json: T } | null {
  for (const path of files.filter((file) => file.endsWith(".json"))) {
    try {
      const json = readJsonRecord(path)
      if (predicate(json)) return { path, json }
    } catch {
      // Keep scanning; invalid JSON is not this export role.
    }
  }
  return null
}

/**
 * Locates and validates files in a PixelLab export directory.
 *
 * @param exportDir - Directory exported from PixelLab.
 * @returns Detected file paths.
 */
export async function analyzePixelLabExport(exportDir: string): Promise<PixelLabExportFiles> {
  if (!existsSync(exportDir)) {
    throw new Error(`PixelLab export directory not found: ${exportDir}`)
  }
  if (!statSync(exportDir).isDirectory()) {
    throw new Error(`PixelLab export path is not a directory: ${exportDir}`)
  }

  const files = listFiles(exportDir)
  const map = findJson(files, isPixelLabMap)
  if (!map) {
    throw new Error(`PixelLab export map JSON not found: ${exportDir}`)
  }

  const terrain = findJson(files, isTerrainMap)
  if (!terrain) {
    throw new Error(`PixelLab export terrain-map JSON not found: ${exportDir}`)
  }

  const transition = findJson(files, isTransitionMap)
  const metadata = findJson(files, (value): value is JsonRecord => isMetadata(value))
  const pngFiles = files.filter((file) => file.endsWith(".png"))
  const mapConfig = map.json.mapConfig
  const compositeCandidates: string[] = []
  let tilesetPng: string | null = null

  for (const png of pngFiles) {
    const dims = await readImageDimensions(png)
    if (
      dims.width === mapConfig.dimensions.pixelWidth &&
      dims.height === mapConfig.dimensions.pixelHeight
    ) {
      compositeCandidates.push(png)
      continue
    }
    if (png.includes(`${join("tilesets", "")}`) || png.includes("/tilesets/")) {
      tilesetPng = png
    }
  }

  const compositePng =
    compositeCandidates.find((png) => png.endsWith("map-composite.png")) ??
    compositeCandidates.find((png) => png.includes("composite")) ??
    null

  if (!compositePng) {
    throw new Error(`PixelLab export map composite PNG not found: ${exportDir}`)
  }

  return {
    exportDir,
    mapJson: map.path,
    terrainMapJson: terrain.path,
    transitionMapJson: transition?.path ?? null,
    compositePng,
    tilesetPng,
    metadataJson: metadata?.path ?? null,
  }
}

/**
 * Scales a 32x32 PNG tile to 64x64 with nearest-neighbor sampling.
 *
 * @param inputPng - PNG tile buffer.
 * @returns Scaled PNG buffer.
 */
export async function scaleTileNearestPng(inputPng: Buffer): Promise<Buffer> {
  return sharp(inputPng)
    .resize(TARGET_TILE_SIZE_PX, TARGET_TILE_SIZE_PX, { kernel: sharp.kernel.nearest })
    .png()
    .toBuffer()
}

/**
 * Scales raw RGBA tile pixels to a 64x64 PNG with nearest-neighbor sampling.
 *
 * @param rawTile - Raw RGBA tile buffer.
 * @returns Scaled PNG buffer.
 */
async function scaleRawTileNearestPng(rawTile: Buffer): Promise<Buffer> {
  return sharp(rawTile, {
    raw: { width: SOURCE_TILE_SIZE_PX, height: SOURCE_TILE_SIZE_PX, channels: 4 },
  })
    .resize(TARGET_TILE_SIZE_PX, TARGET_TILE_SIZE_PX, { kernel: sharp.kernel.nearest })
    .png()
    .toBuffer()
}

/**
 * Crops one raw RGBA tile from the full map composite buffer.
 *
 * @param image - Raw RGBA image buffer.
 * @param imageWidth - Full image width in pixels.
 * @param col - Tile column.
 * @param row - Tile row.
 * @returns Raw RGBA tile buffer.
 */
function cropRawTile(image: Buffer, imageWidth: number, col: number, row: number): Buffer {
  const tile = Buffer.alloc(SOURCE_TILE_SIZE_PX * SOURCE_TILE_SIZE_PX * 4)
  const left = col * SOURCE_TILE_SIZE_PX
  const top = row * SOURCE_TILE_SIZE_PX
  for (let y = 0; y < SOURCE_TILE_SIZE_PX; y++) {
    const sourceStart = ((top + y) * imageWidth + left) * 4
    const targetStart = y * SOURCE_TILE_SIZE_PX * 4
    image.copy(tile, targetStart, sourceStart, sourceStart + SOURCE_TILE_SIZE_PX * 4)
  }
  return tile
}

/**
 * Creates a stable hash for raw tile pixels.
 *
 * @param tile - Raw tile buffer.
 * @returns Hex digest.
 */
function hashTile(tile: Buffer): string {
  return createHash("sha256").update(tile).digest("hex")
}

/**
 * Builds a terrain lookup keyed by original PixelLab cell coordinates.
 *
 * @param terrainMap - Parsed PixelLab terrain map.
 * @returns Terrain id lookup by "x,y".
 */
function buildTerrainLookup(terrainMap: TerrainMap): Map<string, number> {
  const out = new Map<string, number>()
  for (const cell of terrainMap.cells) {
    out.set(`${cell.x},${cell.y}`, cell.terrainId)
  }
  return out
}

/**
 * Builds a transition-cell lookup keyed by original PixelLab cell coordinates.
 *
 * @param transitionMap - Parsed transition map, if present.
 * @returns Edge metadata for coordinates that carry transition edges.
 */
function buildTransitionLookup(
  transitionMap: TransitionMap | null,
): Map<string, Record<string, TransitionEdge>> {
  const out = new Map<string, Record<string, TransitionEdge>>()
  for (const cell of transitionMap?.transitions ?? []) {
    if (Object.keys(cell.edges ?? {}).length > 0) out.set(`${cell.x},${cell.y}`, cell.edges)
  }
  return out
}

/**
 * Merges adjacent axis-aligned rectangles with matching spans.
 *
 * @param rects - Raw collision rectangles.
 * @returns Deterministically merged rectangles.
 */
function mergeColliderRects(rects: readonly ArenaColliderRect[]): ArenaColliderRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.height - b.height || a.x - b.x)
  const rowMerged: ArenaColliderRect[] = []
  for (const rect of sorted) {
    const last = rowMerged[rowMerged.length - 1]
    if (last && last.y === rect.y && last.height === rect.height && last.x + last.width === rect.x) {
      rowMerged[rowMerged.length - 1] = { ...last, width: last.width + rect.width }
    } else {
      rowMerged.push(rect)
    }
  }

  const verticalSorted = rowMerged.sort((a, b) => a.x - b.x || a.width - b.width || a.y - b.y)
  const merged: ArenaColliderRect[] = []
  for (const rect of verticalSorted) {
    const last = merged[merged.length - 1]
    if (last && last.x === rect.x && last.width === rect.width && last.y + last.height === rect.y) {
      merged[merged.length - 1] = { ...last, height: last.height + rect.height }
    } else {
      merged.push(rect)
    }
  }

  return merged.sort((a, b) => a.y - b.y || a.x - b.x || a.height - b.height || a.width - b.width)
}

/**
 * Builds player-blocking terrain colliders for non-dirt terrain.
 *
 * PixelLab's transition-edge metadata is emitted on nearby dirt cells as well
 * as lava cells. Treating those dirt cells as partial colliders creates
 * invisible walls on walkable ground. The terrain id is the reliable signal for
 * movement: upper terrain is dirt and stays walkable; every other terrain id is
 * lava, cliff, or lava-transition art and blocks the full cell.
 *
 * @param col - Tile column in imported map space.
 * @param row - Tile row in imported map space.
 * @param terrainId - PixelLab terrain id at this cell.
 * @param upperTerrainId - Dirt terrain id.
 * @returns Collision rectangles in world pixels.
 */
function terrainColliderRectsForCell(
  col: number,
  row: number,
  terrainId: number,
  upperTerrainId: number,
): ArenaColliderRect[] {
  if (terrainId === upperTerrainId) return []

  const x = col * TARGET_TILE_SIZE_PX
  const y = row * TARGET_TILE_SIZE_PX
  return [{ x, y, width: TARGET_TILE_SIZE_PX, height: TARGET_TILE_SIZE_PX }]
}

/**
 * Tests whether a circle overlaps an axis-aligned tile rectangle.
 *
 * @param cx - Circle center x.
 * @param cy - Circle center y.
 * @param radius - Circle radius.
 * @param rx - Rectangle x.
 * @param ry - Rectangle y.
 * @param size - Square tile size.
 * @returns Whether the circle overlaps the tile.
 */
function circleOverlapsTile(
  cx: number,
  cy: number,
  radius: number,
  rx: number,
  ry: number,
  size: number,
): boolean {
  const nearestX = Math.max(rx, Math.min(cx, rx + size))
  const nearestY = Math.max(ry, Math.min(cy, ry + size))
  const dx = cx - nearestX
  const dy = cy - nearestY
  return dx * dx + dy * dy < radius * radius
}

/**
 * Checks whether a spawn point is clear of blocked tiles.
 *
 * @param x - Spawn center x.
 * @param y - Spawn center y.
 * @param blockedCells - Blocked tile cells.
 * @returns Whether the player circle does not overlap blocked terrain.
 */
function isSpawnSafe(
  x: number,
  y: number,
  blockedCells: readonly { col: number; row: number }[],
): boolean {
  return blockedCells.every(
    (cell) =>
      !circleOverlapsTile(
        x,
        y,
        PLAYER_RADIUS_PX,
        cell.col * TARGET_TILE_SIZE_PX,
        cell.row * TARGET_TILE_SIZE_PX,
        TARGET_TILE_SIZE_PX,
      ),
  )
}

/**
 * Generates safe spawn points around the map center.
 *
 * @param cols - Map width in tiles.
 * @param rows - Map height in tiles.
 * @param blockedCells - Blocked lava or transition cells.
 * @returns Twelve safe spawn points.
 */
function generateSafeSpawnPoints(
  cols: number,
  rows: number,
  blockedCells: readonly { col: number; row: number }[],
): { x: number; y: number }[] {
  const widthPx = cols * TARGET_TILE_SIZE_PX
  const heightPx = rows * TARGET_TILE_SIZE_PX
  const center = { x: widthPx / 2, y: heightPx / 2 }
  const radius = Math.min(widthPx, heightPx) * 0.32
  const candidates: { x: number; y: number; key: string }[] = []

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * TARGET_TILE_SIZE_PX + TARGET_TILE_SIZE_PX / 2
      const y = row * TARGET_TILE_SIZE_PX + TARGET_TILE_SIZE_PX / 2
      if (isSpawnSafe(x, y, blockedCells)) candidates.push({ x, y, key: `${col},${row}` })
    }
  }

  if (candidates.length < SPAWN_POINT_COUNT) {
    throw new Error(
      `PixelLab arena has ${candidates.length} safe spawn cells; expected at least ${SPAWN_POINT_COUNT}.`,
    )
  }

  const selected: { x: number; y: number; key: string }[] = []
  const used = new Set<string>()

  for (let i = 0; i < SPAWN_POINT_COUNT; i++) {
    const angle = (i / SPAWN_POINT_COUNT) * Math.PI * 2
    const target = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }
    const best = candidates
      .filter((candidate) => !used.has(candidate.key))
      .sort((a, b) => {
        const adx = a.x - target.x
        const ady = a.y - target.y
        const bdx = b.x - target.x
        const bdy = b.y - target.y
        return adx * adx + ady * ady - (bdx * bdx + bdy * bdy)
      })[0]
    if (best) {
      selected.push(best)
      used.add(best.key)
    }
  }

  while (selected.length < SPAWN_POINT_COUNT) {
    const best = candidates
      .filter((candidate) => !used.has(candidate.key))
      .sort((a, b) => {
        const aMin = Math.min(
          ...selected.map((point) => {
            const dx = a.x - point.x
            const dy = a.y - point.y
            return dx * dx + dy * dy
          }),
        )
        const bMin = Math.min(
          ...selected.map((point) => {
            const dx = b.x - point.x
            const dy = b.y - point.y
            return dx * dx + dy * dy
          }),
        )
        return bMin - aMin
      })[0]
    if (!best) break
    selected.push(best)
    used.add(best.key)
  }

  return selected.slice(0, SPAWN_POINT_COUNT).map(({ x, y }) => ({ x, y }))
}

/**
 * Builds all derived arena import data from a PixelLab export.
 *
 * @param exportDir - PixelLab export directory.
 * @returns Import data ready to write into the repo.
 */
export async function buildPixelLabArenaImport(exportDir: string): Promise<PixelLabArenaImport> {
  const files = await analyzePixelLabExport(exportDir)
  const map = readJsonRecord(files.mapJson) as PixelLabMap
  const terrainMap = readJsonRecord(files.terrainMapJson) as TerrainMap
  const transitionMap = files.transitionMapJson
    ? (readJsonRecord(files.transitionMapJson) as TransitionMap)
    : null
  const cols = map.mapConfig.dimensions.width
  const rows = map.mapConfig.dimensions.height
  const expectedWidth = cols * SOURCE_TILE_SIZE_PX
  const expectedHeight = rows * SOURCE_TILE_SIZE_PX
  const primaryTileset = map.tilesets[0]
  const upperTerrainId = primaryTileset?.upperTerrainId ?? 2
  const minX = map.mapConfig.boundingBox.minX
  const minY = map.mapConfig.boundingBox.minY
  const terrainLookup = buildTerrainLookup(terrainMap)
  const transitionLookup = buildTransitionLookup(transitionMap)
  const composite = await sharp(files.compositePng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (composite.info.width !== expectedWidth || composite.info.height !== expectedHeight) {
    throw new Error(
      `PixelLab map composite dimensions are ${composite.info.width}x${composite.info.height}; expected ${expectedWidth}x${expectedHeight}.`,
    )
  }

  const tileByHash = new Map<string, number>()
  const uniqueTiles: { tileIndex: number; gid: number; png64: Buffer }[] = []
  const groundGids: number[] = []
  const blockedSpawnCells: { col: number; row: number; gid: number }[] = []
  const blockedSpawnTileGids = new Set<number>()
  const terrainColliders: ArenaColliderRect[] = []

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const rawTile = cropRawTile(composite.data, composite.info.width, col, row)
      const hash = hashTile(rawTile)
      let uniqueIndex = tileByHash.get(hash)
      if (uniqueIndex === undefined) {
        uniqueIndex = uniqueTiles.length
        tileByHash.set(hash, uniqueIndex)
        uniqueTiles.push({
          tileIndex: EXISTING_TERRAIN_TILE_COUNT + uniqueIndex,
          gid: PIXELLAB_FIRST_GID + uniqueIndex,
          png64: await scaleRawTileNearestPng(rawTile),
        })
      }

      const gid = PIXELLAB_FIRST_GID + uniqueIndex
      groundGids.push(gid)

      const sourceX = minX + col
      const sourceY = minY + row
      const key = `${sourceX},${sourceY}`
      const terrainId = terrainLookup.get(key) ?? terrainMap.defaultTerrain
      const transitionEdges = transitionLookup.get(key)
      const isBlockedByTerrain =
        terrainId !== upperTerrainId || (transitionEdges && Object.keys(transitionEdges).length > 0)
      const isBlocked = Boolean(isBlockedByTerrain)
      if (isBlocked) {
        blockedSpawnCells.push({ col, row, gid })
        blockedSpawnTileGids.add(gid)
      }
      terrainColliders.push(
        ...terrainColliderRectsForCell(
          col,
          row,
          terrainId,
          upperTerrainId,
        ),
      )
    }
  }

  const spawnPoints = generateSafeSpawnPoints(cols, rows, blockedSpawnCells)

  return {
    cols,
    rows,
    tileSize: TARGET_TILE_SIZE_PX,
    pixelLabTileCount: uniqueTiles.length,
    firstPixelLabGid: PIXELLAB_FIRST_GID,
    groundGids,
    blockedSpawnTileGids: [...blockedSpawnTileGids].sort((a, b) => a - b),
    blockedSpawnCells,
    terrainColliders: mergeColliderRects(terrainColliders),
    spawnPoints,
    uniqueTiles,
  }
}

/**
 * Validates that the original source terrain tiles are present.
 */
function assertBaseTerrainTiles(): void {
  for (let i = 0; i < EXISTING_TERRAIN_TILE_COUNT; i++) {
    const path = resolve(TERRAIN_DIR, `tile_${i}.png`)
    if (!existsSync(path)) throw new Error(`Expected existing terrain tile: ${path}`)
  }
}

/**
 * Removes generated PixelLab source tiles from previous imports.
 */
function clearGeneratedTerrainTiles(): void {
  for (const file of readdirSync(TERRAIN_DIR)) {
    const match = /^tile_(\d+)\.png$/.exec(file)
    if (!match) continue
    const index = Number.parseInt(match[1], 10)
    if (index >= EXISTING_TERRAIN_TILE_COUNT) rmSync(resolve(TERRAIN_DIR, file))
  }
}

/**
 * Writes scaled PixelLab source tiles to terrain-source.
 *
 * @param imported - Import data.
 */
function writePixelLabSourceTiles(imported: PixelLabArenaImport): void {
  mkdirSync(TERRAIN_DIR, { recursive: true })
  for (const tile of imported.uniqueTiles) {
    writeFileSync(resolve(TERRAIN_DIR, `tile_${tile.tileIndex}.png`), tile.png64)
  }
}

/**
 * Formats generated layout source for shared arena constants.
 *
 * @param imported - Import data.
 * @param exportDir - Source PixelLab export directory.
 * @returns TypeScript source.
 */
function buildArenaLayoutSource(imported: PixelLabArenaImport, exportDir: string): string {
  return `/**
 * AUTO-GENERATED by \`bun run import:pixellab-arena\`. Do not edit by hand.
 * Source: ${exportDir}
 */
export const GENERATED_ARENA_COLS = ${imported.cols}
export const GENERATED_ARENA_ROWS = ${imported.rows}
export const GENERATED_ARENA_PIXELLAB_FIRST_GID = ${imported.firstPixelLabGid}
export const GENERATED_ARENA_BLOCKED_SPAWN_TILE_GIDS = ${JSON.stringify(
    imported.blockedSpawnTileGids,
    null,
    2,
  )} as const
export const GENERATED_ARENA_BLOCKED_SPAWN_CELLS = ${JSON.stringify(
    imported.blockedSpawnCells,
    null,
    2,
  )} as const
export const GENERATED_ARENA_TERRAIN_COLLIDERS = ${JSON.stringify(
    imported.terrainColliders,
    null,
    2,
  )} as const
export const GENERATED_ARENA_SPAWN_POINTS = ${JSON.stringify(imported.spawnPoints, null, 2)} as const
`
}

/**
 * Returns the editable Arena tilemap object from scene JSON.
 *
 * @param scene - Parsed Arena.scene JSON.
 * @returns Editable tilemap object.
 */
function findEditableArenaMap(scene: ArenaScene): JsonRecord {
  const tilemap = (scene.plainObjects ?? []).find(
    (obj) => obj.type === "EditableTilemap" && obj.label === "arenaMap",
  )
  if (!tilemap) {
    throw new Error("Arena.scene must contain an EditableTilemap labelled `arenaMap`.")
  }
  return tilemap
}

/**
 * Ensures existing display objects still fit within the imported map bounds.
 *
 * @param scene - Parsed scene JSON.
 * @param widthPx - Imported arena width in pixels.
 * @param heightPx - Imported arena height in pixels.
 */
function assertDisplayObjectsInBounds(scene: ArenaScene, widthPx: number, heightPx: number): void {
  const offenders = (scene.displayList ?? []).filter((obj) => {
    if (obj.type !== "Image" && obj.type !== "Rectangle") return false
    const x = typeof obj.x === "number" ? obj.x : 0
    const y = typeof obj.y === "number" ? obj.y : 0
    return x < 0 || y < 0 || x > widthPx || y > heightPx
  })
  if (offenders.length > 0) {
    const labels = offenders.map((obj) => obj.label ?? obj.id ?? "(unlabelled)").join(", ")
    throw new Error(`Arena.scene objects outside imported map bounds: ${labels}`)
  }
}

/**
 * Updates Arena.scene with imported tilemap dimensions and ground data.
 *
 * @param imported - Import data.
 */
function writeArenaScene(imported: PixelLabArenaImport): void {
  const scene = JSON.parse(readFileSync(ARENA_SCENE, "utf8")) as ArenaScene
  const widthPx = imported.cols * TARGET_TILE_SIZE_PX
  const heightPx = imported.rows * TARGET_TILE_SIZE_PX
  const tilemap = findEditableArenaMap(scene)
  const layers = Array.isArray(tilemap.layers) ? (tilemap.layers as JsonRecord[]) : []
  const ground = layers.find((layer) => layer.name === "Ground")

  if (!ground) {
    throw new Error("Arena.scene editable tilemap must contain a `Ground` layer.")
  }

  assertDisplayObjectsInBounds(scene, widthPx, heightPx)

  scene.settings = scene.settings ?? {}
  scene.settings.borderWidth = widthPx
  scene.settings.borderHeight = heightPx
  tilemap.width = imported.cols
  tilemap.height = imported.rows
  tilemap.tileWidth = TARGET_TILE_SIZE_PX
  tilemap.tileHeight = TARGET_TILE_SIZE_PX
  tilemap.tilesets = [
    {
      name: "arena-terrain",
      imageKey: "arena-terrain",
      tileWidth: TARGET_TILE_SIZE_PX,
      tileHeight: TARGET_TILE_SIZE_PX,
      tileMargin: 0,
      tileSpacing: 0,
    },
  ]
  ground.data = JSON.stringify(imported.groundGids)
  ground.width = imported.cols
  ground.height = imported.rows
  ground.tileWidth = TARGET_TILE_SIZE_PX
  ground.tileHeight = TARGET_TILE_SIZE_PX

  writeFileSync(ARENA_SCENE, `${JSON.stringify(scene, null, 4)}\n`, "utf8")
}

/**
 * Extracts a Phaser Editor user-code section from Arena.ts.
 *
 * @param source - Existing Arena.ts source.
 * @param start - Start marker text.
 * @param end - End marker text.
 * @returns Section contents including original surrounding newlines.
 */
function extractUserSection(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end)
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return "\n"
  const section = source.slice(startIndex + start.length, endIndex)
  if (section.trim().length === 0) return "\n"
  return section.replace(/\n[\t ]*$/, "\n")
}

/**
 * Builds image creation statements from Arena.scene display objects.
 *
 * @param scene - Parsed scene JSON.
 * @returns TypeScript statements for image objects.
 */
function buildImageStatements(scene: ArenaScene): string {
  return (scene.displayList ?? [])
    .filter((obj) => obj.type === "Image" && isRecord(obj.texture))
    .map((obj) => {
      const label = String(obj.label ?? "image")
      const x = Number(obj.x ?? 0)
      const y = Number(obj.y ?? 0)
      const key = String((obj.texture as JsonRecord).key)
      return `\n\t\t// ${label}\n\t\tthis.add.image(${x}, ${y}, "${key}");`
    })
    .join("\n")
}

/**
 * Rebuilds the generated Arena.ts compiled tilemap block from Arena.scene.
 *
 * @param imported - Import data.
 */
function writeArenaTs(imported: PixelLabArenaImport): void {
  const source = readFileSync(ARENA_TS, "utf8")
  const scene = JSON.parse(readFileSync(ARENA_SCENE, "utf8")) as ArenaScene
  const userImports = extractUserSection(
    source,
    "/* START-USER-IMPORTS */",
    "/* END-USER-IMPORTS */",
  )
  const userCtr = extractUserSection(
    source,
    "/* START-USER-CTR-CODE */",
    "/* END-USER-CTR-CODE */",
  )
  const userCode = extractUserSection(source, "/* START-USER-CODE */", "/* END-USER-CODE */")
  const tileCount = EXISTING_TERRAIN_TILE_COUNT + imported.pixelLabTileCount
  const layerData = `[${imported.groundGids.join(", ")}]`
  const imageStatements = buildImageStatements(scene)

  const generated = `// You can write more code here

/* START OF COMPILED CODE */

/* START-USER-IMPORTS */${userImports}/* END-USER-IMPORTS */

export default class Arena extends Phaser.Scene {

\tconstructor() {
\t\tsuper("Arena");

\t\t/* START-USER-CTR-CODE */${userCtr}\t\t/* END-USER-CTR-CODE */
\t}

\teditorCreate(): void {

\t\t// arenaMap
\t\tthis.cache.tilemap.add("arenaMap_arenaMap", {
\t\t\tformat: 1,
\t\t\tdata: {
\t\t\t\twidth: ${imported.cols},
\t\t\t\theight: ${imported.rows},
\t\t\t\torientation: "orthogonal",
\t\t\t\ttilewidth: ${TARGET_TILE_SIZE_PX},
\t\t\t\ttileheight: ${TARGET_TILE_SIZE_PX},
\t\t\t\ttilesets: [
\t\t\t\t\t{
\t\t\t\t\t\tcolumns: ${tileCount},
\t\t\t\t\t\tmargin: 0,
\t\t\t\t\t\tspacing: 0,
\t\t\t\t\t\ttilewidth: ${TARGET_TILE_SIZE_PX},
\t\t\t\t\t\ttileheight: ${TARGET_TILE_SIZE_PX},
\t\t\t\t\t\ttilecount: ${tileCount},
\t\t\t\t\t\tfirstgid: 1,
\t\t\t\t\t\timage: "arena-terrain",
\t\t\t\t\t\tname: "arena-terrain",
\t\t\t\t\t\timagewidth: ${tileCount * TARGET_TILE_SIZE_PX},
\t\t\t\t\t\timageheight: ${TARGET_TILE_SIZE_PX},
\t\t\t\t\t},
\t\t\t\t],
\t\t\t\tlayers: [
\t\t\t\t\t{
\t\t\t\t\t\ttype: "tilelayer",
\t\t\t\t\t\tname: "Ground",
\t\t\t\t\t\twidth: ${imported.cols},
\t\t\t\t\t\theight: ${imported.rows},
\t\t\t\t\t\topacity: 1,
\t\t\t\t\t\tdata: ${layerData},
\t\t\t\t\t},
\t\t\t\t],
\t\t\t},
\t\t});
\t\tconst arenaMap = this.add.tilemap("arenaMap_arenaMap");
\t\tarenaMap.addTilesetImage("arena-terrain");

\t\t// Ground
\t\tarenaMap.createLayer("Ground", ["arena-terrain"], 0, 0);
${imageStatements}

\t\tthis.arenaMap = arenaMap;

\t\tthis.events.emit("scene-awake");
\t}

\tprivate arenaMap!: Phaser.Tilemaps.Tilemap;

\t/* START-USER-CODE */${userCode}\t/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here
`

  writeFileSync(ARENA_TS, generated, "utf8")
}

/**
 * Writes all PixelLab arena import outputs into the repository.
 *
 * @param exportDir - PixelLab export directory.
 */
export async function importPixelLabArena(exportDir: string): Promise<void> {
  const files = await analyzePixelLabExport(exportDir)
  const imported = await buildPixelLabArenaImport(exportDir)
  assertBaseTerrainTiles()
  clearGeneratedTerrainTiles()
  writePixelLabSourceTiles(imported)
  await buildTerrainSheet()
  writeFileSync(GENERATED_LAYOUT, buildArenaLayoutSource(imported, exportDir), "utf8")
  writeArenaScene(imported)
  writeArenaTs(imported)
  const { exportArenaTilemap } = await import("./export-arena-tilemap")
  exportArenaTilemap(false)

  console.log(`Imported PixelLab arena from ${files.exportDir}`)
  console.log(`Map: ${imported.cols}x${imported.rows} tiles (${imported.cols * 64}x${imported.rows * 64}px)`)
  console.log(
    `PixelLab GIDs: ${imported.firstPixelLabGid}..${
      imported.firstPixelLabGid + imported.pixelLabTileCount - 1
    }`,
  )
  console.log(`Blocked spawn GIDs: ${imported.blockedSpawnTileGids.join(", ")}`)
  console.log(`Terrain colliders: ${imported.terrainColliders.length}`)
}

/**
 * Prints a write-free import summary for a PixelLab export.
 *
 * @param exportDir - PixelLab export directory.
 */
async function dryRun(exportDir: string): Promise<void> {
  const files = await analyzePixelLabExport(exportDir)
  const imported = await buildPixelLabArenaImport(exportDir)
  console.log(`PixelLab export: ${files.exportDir}`)
  console.log(`Map JSON: ${files.mapJson}`)
  console.log(`Terrain map JSON: ${files.terrainMapJson}`)
  console.log(`Transition map JSON: ${files.transitionMapJson ?? "(none)"}`)
  console.log(`Composite PNG: ${files.compositePng}`)
  console.log(`Tileset PNG: ${files.tilesetPng ?? "(none)"}`)
  console.log(`Metadata JSON: ${files.metadataJson ?? "(not exported; using composite PNG)"}`)
  console.log(`Map size: ${imported.cols}x${imported.rows} tiles`)
  console.log(`Source tile size: ${SOURCE_TILE_SIZE_PX}px`)
  console.log(`Final tile size: ${TARGET_TILE_SIZE_PX}px`)
  console.log(`PixelLab unique tiles: ${imported.pixelLabTileCount}`)
  console.log(
    `Final PixelLab GID range: ${imported.firstPixelLabGid}..${
      imported.firstPixelLabGid + imported.pixelLabTileCount - 1
    }`,
  )
  console.log(`Blocked spawn GIDs: ${imported.blockedSpawnTileGids.join(", ")}`)
  console.log(`Terrain colliders: ${imported.terrainColliders.length}`)
}

/**
 * Parses CLI args and runs the importer.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dry = args.includes("--dry-run")
  const exportDir = args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_PIXELLAB_EXPORT_DIR
  if (dry) await dryRun(exportDir)
  else await importPixelLabArena(exportDir)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
