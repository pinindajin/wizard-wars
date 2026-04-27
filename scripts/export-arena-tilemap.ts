import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  ARENA_COLS,
  ARENA_ROWS,
  ARENA_SPAWN_POINTS,
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
const GENERATED_NON_WALKABLE_COLLIDERS = resolve(
  ROOT,
  "src/shared/balance-config/generated/arena-non-walkable-colliders.ts",
)
const ARENA_TILESET = resolve(ROOT, "public/assets/tilesets/arena-terrain.png")

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
  readonly layers: readonly [TiledTileLayer, TiledObjectLayer, TiledObjectLayer, TiledObjectLayer]
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
  return ARENA_SPAWN_POINTS.map((point, i) => {
    return {
      id: i + 1,
      name: `spawn-point-${i}`,
      type: "spawn-point",
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
      visible: true,
      properties: [{ name: "spawnIndex", type: "int", value: i }],
    }
  })
}

/**
 * Reads width/height from a PNG header without pulling in async image APIs.
 *
 * @param path - PNG file path.
 * @returns Image dimensions in pixels.
 */
function readPngDimensions(path: string): { width: number; height: number } {
  const bytes = readFileSync(path)
  const pngSignature = "89504e470d0a1a0a"
  if (bytes.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error(`Expected PNG tileset at ${path}`)
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

function readSceneRectangleObjects(
  scene: ArenaScene,
  labelPrefix: string,
  tiledType: string,
  firstId: number,
): TiledObject[] {
  return (scene.displayList ?? [])
    .filter((obj) => obj.type === "Rectangle" && obj.label?.startsWith(labelPrefix))
    .map((obj, index) => {
      const width = obj.width ?? 0
      const height = obj.height ?? 0
      const originX = obj.originX ?? 0.5
      const originY = obj.originY ?? 0.5
      return {
        id: firstId + index,
        name: obj.label ?? `${labelPrefix}${index}`,
        type: tiledType,
        x: (obj.x ?? 0) - width * originX,
        y: (obj.y ?? 0) - height * originY,
        width,
        height,
        visible: obj.visible ?? false,
      }
    })
    .filter((obj) => obj.width > 0 && obj.height > 0)
}

function readPropColliderObjects(scene: ArenaScene): TiledObject[] {
  return readSceneRectangleObjects(scene, "propCollider_", "prop-collider", 100)
}

function readNonWalkableObjects(scene: ArenaScene): TiledObject[] {
  return readSceneRectangleObjects(scene, "nonWalkableArea_", "non-walkable-area", 1000)
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
    throw new Error(
      `Arena.scene dimensions must remain ${ARENA_COLS}x${ARENA_ROWS} tiles at ${TILE_SIZE_PX}x${TILE_SIZE_PX} px.`,
    )
  }

  const groundData = readGroundData(tilemap)
  const propObjects = readPropColliderObjects(scene)
  const nonWalkableObjects = readNonWalkableObjects(scene)
  const tilesetImage = readPngDimensions(ARENA_TILESET)
  const tilesetColumns = tilesetImage.width / TILE_SIZE_PX
  const tilesetRows = tilesetImage.height / TILE_SIZE_PX
  const highestObjectId = Math.max(
    0,
    ...generateSpawnPointObjects().map((obj) => obj.id),
    ...propObjects.map((obj) => obj.id),
    ...nonWalkableObjects.map((obj) => obj.id),
  )

  if (!Number.isInteger(tilesetColumns) || !Number.isInteger(tilesetRows)) {
    throw new Error(
      `arena-terrain.png dimensions must be divisible by ${TILE_SIZE_PX}; got ${tilesetImage.width}x${tilesetImage.height}.`,
    )
  }

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
    nextlayerid: 5,
    nextobjectid: highestObjectId + 1,
    tilesets: [
      {
        firstgid: 1,
        name: tileset.name,
        tilewidth: tileset.tileWidth,
        tileheight: tileset.tileHeight,
        spacing: tileset.tileSpacing ?? 0,
        margin: tileset.tileMargin ?? 0,
        columns: tilesetColumns,
        tilecount: tilesetColumns * tilesetRows,
        image: "../tilesets/arena-terrain.png",
        imagewidth: tilesetImage.width,
        imageheight: tilesetImage.height,
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
      {
        id: 4,
        name: "NonWalkableAreas",
        type: "objectgroup",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        draworder: "topdown",
        objects: nonWalkableObjects,
      },
    ],
  }
}

function buildGeneratedCollidersSource(
  tilemap: TiledMap,
  layerName: string,
  exportName: string,
): string {
  const objectLayer = tilemap.layers.find(
    (layer): layer is TiledObjectLayer =>
      layer.type === "objectgroup" && layer.name === layerName,
  )
  const rects =
    objectLayer?.objects.map(({ x, y, width, height }) => ({ x, y, width, height })) ?? []

  return `/**
 * AUTO-GENERATED by \`bun run build:arena-colliders\`. Do not edit by hand.
 * Source: public/assets/tilemaps/arena.json (object layer ${layerName}).
 */
export const ${exportName} = ${JSON.stringify(rects, null, 2)} as const
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
  const propCollidersSource = buildGeneratedCollidersSource(
    tilemap,
    "PropColliders",
    "GENERATED_ARENA_PROP_COLLIDERS",
  )
  const nonWalkableCollidersSource = buildGeneratedCollidersSource(
    tilemap,
    "NonWalkableAreas",
    "GENERATED_ARENA_NON_WALKABLE_COLLIDERS",
  )

  if (checkOnly) {
    assertSameFile(ARENA_JSON, tilemapSource)
    assertSameFile(GENERATED_COLLIDERS, propCollidersSource)
    assertSameFile(GENERATED_NON_WALKABLE_COLLIDERS, nonWalkableCollidersSource)
    console.log("Arena editor parity OK")
    return
  }

  writeFileSync(ARENA_JSON, tilemapSource, "utf8")
  writeFileSync(GENERATED_COLLIDERS, propCollidersSource, "utf8")
  writeFileSync(GENERATED_NON_WALKABLE_COLLIDERS, nonWalkableCollidersSource, "utf8")
  console.log(`Wrote ${ARENA_JSON}`)
}

function main(): void {
  exportArenaTilemap(process.argv.includes("--check"))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
