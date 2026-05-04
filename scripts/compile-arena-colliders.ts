/**
 * Reads `public/assets/tilemaps/arena.json`, extracts axis-aligned rectangles
 * from known Tiled object layers, and writes generated collider constants.
 *
 * Run: `bun run build:arena-colliders`
 *
 * In Tiled/Phaser Editor, add rectangle objects on supported object layers
 * (width/height > 0). Point objects are skipped.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { lavaTransitionRectsFromNonWalkableAndLava } from "./lava-transition-rects"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, "..")
const ARENA_JSON = resolve(ROOT, "public/assets/tilemaps/arena.json")
const OUT_DIR = resolve(ROOT, "src/shared/balance-config/generated")
const COLLIDER_OUTPUTS = [
  {
    layerName: "PropColliders",
    exportName: "GENERATED_ARENA_PROP_COLLIDERS",
    fileName: "arena-prop-colliders.ts",
  },
  {
    layerName: "NonWalkableAreas",
    exportName: "GENERATED_ARENA_NON_WALKABLE_COLLIDERS",
    fileName: "arena-non-walkable-colliders.ts",
  },
  {
    layerName: "LavaAreas",
    exportName: "GENERATED_ARENA_LAVA_COLLIDERS",
    fileName: "arena-lava-colliders.ts",
  },
  {
    layerName: "CliffAreas",
    exportName: "GENERATED_ARENA_CLIFF_COLLIDERS",
    fileName: "arena-cliff-colliders.ts",
  },
] as const

const LAVA_TILE_IDS = new Set([
  21, 22, 23, 24, 25, 26, 27, 28, 30, 32, 33, 36, 40, 41, 43, 44, 48, 49,
  51, 52, 54, 55, 59, 60, 64, 65, 68, 69, 76, 77, 79, 80, 82, 84, 85, 87,
  88, 93, 94, 95, 97, 98, 100, 101, 102, 104, 105, 106, 107, 112, 113, 118,
  119, 122, 123, 125, 127, 128, 129, 130, 132, 135, 136, 137, 139, 140, 141,
  142, 145, 146, 148, 149, 150, 151, 152, 153, 155, 157, 158, 159, 160, 167,
  168, 173, 174, 177, 178, 180, 182, 183, 185, 186, 189, 190, 191, 193, 194,
  199, 202, 205, 207, 209, 210, 211, 213, 214, 215, 218, 219, 220, 221, 222,
  223, 224, 225, 226, 227, 228,
])

type TiledObject = {
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
}

type TiledLayer = {
  readonly name?: string
  readonly type?: string
  readonly width?: number
  readonly height?: number
  readonly data?: readonly number[]
  readonly objects?: readonly TiledObject[]
}

type TiledMap = {
  readonly tilewidth?: number
  readonly tileheight?: number
  readonly layers?: readonly TiledLayer[]
}

type Rect = { x: number; y: number; width: number; height: number }

function readColliderRects(
  map: TiledMap,
  layerName: string,
): Rect[] {
  const layers = map.layers ?? []
  const layer = layers.find((l) => l.type === "objectgroup" && l.name === layerName)
  const objects = layer?.objects ?? []

  const rects: Rect[] = []
  for (const obj of objects) {
    const w = obj.width ?? 0
    const h = obj.height ?? 0
    if (w <= 0 || h <= 0) continue
    rects.push({
      x: obj.x ?? 0,
      y: obj.y ?? 0,
      width: w,
      height: h,
    })
  }
  return rects
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

function mergeTileRects(rects: readonly Rect[]): Rect[] {
  const rows = new Map<number, Rect[]>()
  for (const rect of rects) {
    const row = rows.get(rect.y) ?? []
    row.push(rect)
    rows.set(rect.y, row)
  }

  const horizontal: Rect[] = []
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x)
    for (const rect of row) {
      const last = horizontal[horizontal.length - 1]
      if (last && last.y === rect.y && last.height === rect.height && last.x + last.width === rect.x) {
        last.width += rect.width
      } else {
        horizontal.push({ ...rect })
      }
    }
  }

  horizontal.sort((a, b) => a.x - b.x || a.width - b.width || a.y - b.y)
  const merged: Rect[] = []
  for (const rect of horizontal) {
    const last = merged[merged.length - 1]
    if (last && last.x === rect.x && last.width === rect.width && last.y + last.height === rect.y) {
      last.height += rect.height
    } else {
      merged.push({ ...rect })
    }
  }
  return merged.sort((a, b) => a.y - b.y || a.x - b.x)
}

function lavaRectsFromGround(map: TiledMap): Rect[] {
  const ground = (map.layers ?? []).find((layer) => layer.type === "tilelayer" && layer.name === "Ground")
  const data = ground?.data ?? []
  const width = ground?.width ?? 0
  const tileW = map.tilewidth ?? 64
  const tileH = map.tileheight ?? 64
  const rects: Rect[] = []
  for (let i = 0; i < data.length; i++) {
    if (!LAVA_TILE_IDS.has(data[i] ?? 0)) continue
    const col = i % width
    const row = Math.floor(i / width)
    rects.push({ x: col * tileW, y: row * tileH, width: tileW, height: tileH })
  }
  return mergeTileRects(rects)
}

function hazardRects(map: TiledMap, kind: "lava" | "cliff"): Rect[] {
  const explicit = readColliderRects(map, kind === "lava" ? "LavaAreas" : "CliffAreas")
  const lava = [...lavaRectsFromGround(map), ...explicit]
  if (kind === "lava") return lava

  const nonWalkable = readColliderRects(map, "NonWalkableAreas")
  const inferredCliff = nonWalkable.filter((rect) => !lava.some((lavaRect) => rectsOverlap(rect, lavaRect)))
  return [...inferredCliff, ...readColliderRects(map, "CliffAreas")]
}

function buildSource(
  layerName: string,
  exportName: string,
  rects: readonly { x: number; y: number; width: number; height: number }[],
): string {
  return `/**
 * AUTO-GENERATED by \`bun run build:arena-colliders\`. Do not edit by hand.
 * Source: public/assets/tilemaps/arena.json (object layer ${layerName}).
 */
export const ${exportName} = ${JSON.stringify(rects, null, 2)} as const
`
}

/** Must match `buildGeneratedHazardSource` in `export-arena-tilemap.ts` so `--check` passes after compile. */
function buildHybridHazardSource(
  kind: "lava" | "cliff",
  exportName: string,
  rects: readonly { x: number; y: number; width: number; height: number }[],
): string {
  return `/**
 * AUTO-GENERATED by \`bun run build:arena-colliders\`. Do not edit by hand.
 * Source: public/assets/tilemaps/arena.json (${kind} hybrid hazard generation).
 */
export const ${exportName} = ${JSON.stringify(rects, null, 2)} as const
`
}

function buildTransitionSource(rects: readonly Rect[]): string {
  return `/**
 * AUTO-GENERATED by \`bun run build:arena-colliders\`. Do not edit by hand.
 * Source: public/assets/tilemaps/arena.json (NonWalkableAreas overlapping hybrid lava, boundary subset).
 */
export const GENERATED_ARENA_LAVA_TRANSITION_COLLIDERS = ${JSON.stringify(rects, null, 2)} as const
`
}

function main(): void {
  const raw = readFileSync(ARENA_JSON, "utf8")
  const map = JSON.parse(raw) as TiledMap

  mkdirSync(OUT_DIR, { recursive: true })

  for (const output of COLLIDER_OUTPUTS) {
    const rects =
      output.layerName === "LavaAreas"
        ? hazardRects(map, "lava")
        : output.layerName === "CliffAreas"
          ? hazardRects(map, "cliff")
          : readColliderRects(map, output.layerName)
    const outFile = resolve(OUT_DIR, output.fileName)
    const body =
      output.layerName === "LavaAreas"
        ? buildHybridHazardSource("lava", output.exportName, rects)
        : output.layerName === "CliffAreas"
          ? buildHybridHazardSource("cliff", output.exportName, rects)
          : buildSource(output.layerName, output.exportName, rects)
    writeFileSync(outFile, body, "utf8")
    console.log(`Wrote ${rects.length} collider(s) to ${outFile}`)
  }

  const lavaHybrid = hazardRects(map, "lava")
  const nonWalkable = readColliderRects(map, "NonWalkableAreas")
  const transition = lavaTransitionRectsFromNonWalkableAndLava(nonWalkable, lavaHybrid)
  const transitionPath = resolve(OUT_DIR, "arena-lava-transition-colliders.ts")
  writeFileSync(transitionPath, buildTransitionSource(transition), "utf8")
  console.log(`Wrote ${transition.length} lava transition collider(s) to ${transitionPath}`)
}

main()
