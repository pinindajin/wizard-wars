import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_COLS,
  ARENA_ROWS,
  ARENA_SPAWN_RING_RADIUS_PX,
  SPAWN_POINT_COUNT,
  TILE_SIZE_PX,
} from "../src/shared/balance-config/arena"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, "..")
const ARENA_SCENE = resolve(ROOT, "src/game/scenes/Arena.scene")
const ARENA_JSON = resolve(ROOT, "public/assets/tilemaps/arena.json")
const GENERATED_COLLIDERS = resolve(
  ROOT,
  "src/shared/balance-config/generated/arena-prop-colliders.ts",
)

type EditableTileset = {
  readonly name: string
  readonly imageKey: string
  readonly tileWidth: number
  readonly tileHeight: number
  readonly tileMargin?: number
  readonly tileSpacing?: number
}

type EditableLayer = {
  readonly name: string
  readonly data: string
  readonly width: number
  readonly height: number
  readonly tileWidth: number
  readonly tileHeight: number
}

type EditableTilemap = {
  readonly type: "EditableTilemap"
  readonly id: string
  readonly label: string
  readonly width: number
  readonly height: number
  readonly tileWidth: number
  readonly tileHeight: number
  readonly tilesets: readonly EditableTileset[]
  readonly layers: readonly EditableLayer[]
}

type SceneRectangle = {
  readonly type?: string
  readonly id?: string
  readonly label?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly originX?: number
  readonly originY?: number
  readonly visible?: boolean
}

type ArenaScene = {
  readonly displayList?: readonly SceneRectangle[]
  readonly plainObjects?: readonly unknown[]
}

type TiledObject = {
  readonly id: number
  readonly name: string
  readonly type: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly visible: boolean
  readonly properties?: readonly {
    readonly name: string
    readonly type: string
    readonly value: number
  }[]
}

type TiledTileLayer = {
  readonly id: number
  readonly name: string
  readonly type: "tilelayer"
  readonly visible: boolean
  readonly opacity: 1
  readonly x: 0
  readonly y: 0
  readonly width: number
  readonly height: number
  readonly data: readonly number[]
}

type TiledObjectLayer = {
  readonly id: number
  readonly name: string
  readonly type: "objectgroup"
  readonly visible: boolean
  readonly opacity: 1
  readonly x: 0
  readonly y: 0
  readonly draworder: "topdown"
  readonly objects: readonly TiledObject[]
}

type TiledMap = {
  readonly width: number
  readonly height: number
  readonly tilewidth: number
  readonly tileheight: number
  readonly orientation: "orthogonal"
  readonly renderorder: "right-down"
  readonly version: "1.10"
  readonly tiledversion: "1.10.2"
  readonly infinite: false
  readonly nextlayerid: number
  readonly nextobjectid: number
  readonly tilesets: readonly {
    readonly firstgid: 1
    readonly name: string
    readonly tilewidth: number
    readonly tileheight: number
    readonly spacing: number
    readonly margin: number
    readonly columns: number
    readonly tilecount: number
    readonly image: string
    readonly imagewidth: number
    readonly imageheight: number
  }[]
  readonly layers: readonly [TiledTileLayer, TiledObjectLayer, TiledObjectLayer]
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function readArenaScene(): ArenaScene {
  return readJson<ArenaScene>(ARENA_SCENE)
}

function findArenaMap(scene: ArenaScene): EditableTilemap {
  const match = (scene.plainObjects ?? []).find((obj): obj is EditableTilemap => {
    return Boolean(
      obj &&
        typeof obj === "object" &&
        (obj as EditableTilemap).type === "EditableTilemap" &&
        (obj as EditableTilemap).label === "arenaMap",
    )
  })

  if (!match) {
    throw new Error("Arena.scene must contain an EditableTilemap plain object labelled `arenaMap`.")
  }

  return match
}

function readGroundData(tilemap: EditableTilemap): readonly number[] {
  const ground = tilemap.layers.find((layer) => layer.name === "Ground")
  if (!ground) {
    throw new Error("Arena.scene editable tilemap must contain a `Ground` layer.")
  }

  const data = JSON.parse(ground.data) as unknown
  if (!Array.isArray(data) || !data.every((value) => Number.isInteger(value))) {
    throw new Error("Arena.scene Ground layer data must be a flat integer array.")
  }
  if (data.length !== tilemap.width * tilemap.height) {
    throw new Error(
      `Arena.scene Ground layer has ${data.length} tiles; expected ${tilemap.width * tilemap.height}.`,
    )
  }

  return data as number[]
}

function generateSpawnPointObjects(): TiledObject[] {
  return Array.from({ length: SPAWN_POINT_COUNT }, (_, i) => {
    const angleDeg = i * 30
    const angleRad = (angleDeg * Math.PI) / 180
    const x = Math.round(ARENA_CENTER_X + ARENA_SPAWN_RING_RADIUS_PX * Math.cos(angleRad))
    const y = Math.round(ARENA_CENTER_Y + ARENA_SPAWN_RING_RADIUS_PX * Math.sin(angleRad))
    return {
      id: i + 1,
      name: `spawn-point-${i}`,
      type: "spawn-point",
      x,
      y,
      width: 0,
      height: 0,
      visible: true,
      properties: [{ name: "spawnIndex", type: "int", value: i }],
    }
  })
}

function readPropColliderObjects(scene: ArenaScene): TiledObject[] {
  return (scene.displayList ?? [])
    .filter((obj) => obj.type === "Rectangle" && obj.label?.startsWith("propCollider_"))
    .map((obj, index) => {
      const width = obj.width ?? 0
      const height = obj.height ?? 0
      const originX = obj.originX ?? 0.5
      const originY = obj.originY ?? 0.5
      return {
        id: 100 + index,
        name: obj.label ?? `propCollider_${index}`,
        type: "prop-collider",
        x: (obj.x ?? 0) - width * originX,
        y: (obj.y ?? 0) - height * originY,
        width,
        height,
        visible: obj.visible ?? false,
      }
    })
    .filter((obj) => obj.width > 0 && obj.height > 0)
}

export function buildArenaTilemapFromScene(scene = readArenaScene()): TiledMap {
  const tilemap = findArenaMap(scene)
  const tileset = tilemap.tilesets.find((item) => item.name === "arena-terrain")
  if (!tileset) {
    throw new Error("Arena.scene editable tilemap must use the `arena-terrain` tileset.")
  }
  if (
    tilemap.width !== ARENA_COLS ||
    tilemap.height !== ARENA_ROWS ||
    tilemap.tileWidth !== TILE_SIZE_PX ||
    tilemap.tileHeight !== TILE_SIZE_PX
  ) {
    throw new Error("Arena.scene dimensions must remain 21x12 tiles at 64x64 px.")
  }

  const groundData = readGroundData(tilemap)
  const propObjects = readPropColliderObjects(scene)

  return {
    width: ARENA_COLS,
    height: ARENA_ROWS,
    tilewidth: TILE_SIZE_PX,
    tileheight: TILE_SIZE_PX,
    orientation: "orthogonal",
    renderorder: "right-down",
    version: "1.10",
    tiledversion: "1.10.2",
    infinite: false,
    nextlayerid: 4,
    nextobjectid: 100 + propObjects.length,
    tilesets: [
      {
        firstgid: 1,
        name: tileset.name,
        tilewidth: tileset.tileWidth,
        tileheight: tileset.tileHeight,
        spacing: tileset.tileSpacing ?? 0,
        margin: tileset.tileMargin ?? 0,
        columns: 16,
        tilecount: 16,
        image: "../tilesets/arena-terrain.png",
        imagewidth: 1024,
        imageheight: 64,
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
        width: ARENA_COLS,
        height: ARENA_ROWS,
        data: groundData,
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
      {
        id: 3,
        name: "PropColliders",
        type: "objectgroup",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        draworder: "topdown",
        objects: propObjects,
      },
    ],
  }
}

function buildGeneratedCollidersSource(tilemap: TiledMap): string {
  const propLayer = tilemap.layers.find(
    (layer): layer is TiledObjectLayer =>
      layer.type === "objectgroup" && layer.name === "PropColliders",
  )
  const rects =
    propLayer?.objects.map(({ x, y, width, height }) => ({ x, y, width, height })) ?? []

  return `/**
 * AUTO-GENERATED by \`bun run build:arena-colliders\`. Do not edit by hand.
 * Source: public/assets/tilemaps/arena.json (object layer PropColliders).
 */
export const GENERATED_ARENA_PROP_COLLIDERS = ${JSON.stringify(rects, null, 2)} as const
`
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function assertSameFile(path: string, expected: string): void {
  const actual = existsSync(path) ? readFileSync(path, "utf8") : ""
  if (actual !== expected) {
    throw new Error(`${path} is out of date. Run \`bun run export:arena-tilemap\`.`)
  }
}

export function exportArenaTilemap(checkOnly = false): void {
  const tilemap = buildArenaTilemapFromScene()
  const tilemapSource = stableStringify(tilemap)
  const collidersSource = buildGeneratedCollidersSource(tilemap)

  if (checkOnly) {
    assertSameFile(ARENA_JSON, tilemapSource)
    assertSameFile(GENERATED_COLLIDERS, collidersSource)
    console.log("Arena editor parity OK")
    return
  }

  writeFileSync(ARENA_JSON, tilemapSource, "utf8")
  console.log(`Wrote ${ARENA_JSON}`)
}

function main(): void {
  exportArenaTilemap(process.argv.includes("--check"))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
