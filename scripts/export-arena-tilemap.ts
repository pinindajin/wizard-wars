import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { lavaTransitionRectsFromNonWalkableAndLava } from "./lava-transition-rects"

import {
  ARENA_HEIGHT,
  ARENA_SPAWN_POINTS,
  ARENA_WIDTH,
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
const GENERATED_LAVA_COLLIDERS = resolve(
  ROOT,
  "src/shared/balance-config/generated/arena-lava-colliders.ts",
)
const GENERATED_CLIFF_COLLIDERS = resolve(
  ROOT,
  "src/shared/balance-config/generated/arena-cliff-colliders.ts",
)
const GENERATED_LAVA_TRANSITION_COLLIDERS = resolve(
  ROOT,
  "src/shared/balance-config/generated/arena-lava-transition-colliders.ts",
)

type SceneObject = {
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
  readonly texture?: { readonly key?: string }
}

type ArenaScene = {
  readonly displayList?: readonly SceneObject[]
  readonly settings?: {
    readonly borderWidth?: number
    readonly borderHeight?: number
  }
  readonly meta?: {
    readonly version?: number
  }
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

type TiledImageLayer = {
  readonly id: number
  readonly name: string
  readonly type: "imagelayer"
  readonly visible: boolean
  readonly opacity: 1
  readonly x: 0
  readonly y: 0
  readonly image: string
}

type TiledTileLayer = {
  readonly id: number
  readonly name: string
  readonly type: "tilelayer"
  readonly width: number
  readonly height: number
  readonly data: readonly number[]
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
  readonly tilesets: readonly []
  readonly layers: readonly (TiledImageLayer | TiledObjectLayer | TiledTileLayer)[]
}

type Rect = { x: number; y: number; width: number; height: number }

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function readArenaScene(): ArenaScene {
  return readJson<ArenaScene>(ARENA_SCENE)
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
        visible: obj.visible ?? true,
      }
    })
    .filter((obj) => obj.width > 0 && obj.height > 0)
}

function objectLayer(
  id: number,
  name: string,
  objects: readonly TiledObject[],
): TiledObjectLayer {
  return {
    id,
    name,
    type: "objectgroup",
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    draworder: "topdown",
    objects,
  }
}

function imageLayer(): TiledImageLayer {
  return {
    id: 1,
    name: "ArenaBase",
    type: "imagelayer",
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    image: "../maps/arena-base.png",
  }
}

function assertNativeScene(scene: ArenaScene): void {
  if (scene.meta?.version !== 5) {
    throw new Error("Arena.scene must remain Phaser Editor version 5.")
  }
  if (scene.settings?.borderWidth !== ARENA_WIDTH || scene.settings?.borderHeight !== ARENA_HEIGHT) {
    throw new Error(`Arena.scene bounds must remain ${ARENA_WIDTH}x${ARENA_HEIGHT}.`)
  }
  const base = (scene.displayList ?? []).find(
    (obj) => obj.type === "Image" && obj.texture?.key === "arena-base",
  )
  if (!base) {
    throw new Error("Arena.scene must contain an Image using texture key `arena-base`.")
  }
}

export function buildArenaTilemapFromScene(scene = readArenaScene()): TiledMap {
  assertNativeScene(scene)

  const spawnObjects = generateSpawnPointObjects()
  const propObjects = readSceneRectangleObjects(scene, "propCollider_", "prop-collider", 100)
  const nonWalkableObjects = readSceneRectangleObjects(scene, "nonWalkableArea_", "non-walkable-area", 1000)
  const lavaObjects = readSceneRectangleObjects(scene, "lavaArea_", "lava-area", 2000)
  const cliffObjects = readSceneRectangleObjects(scene, "cliffArea_", "cliff-area", 3000)
  const walkableObjects = readSceneRectangleObjects(scene, "walkableArea_", "walkable-area", 4000)

  const highestObjectId = Math.max(
    0,
    ...spawnObjects.map((obj) => obj.id),
    ...propObjects.map((obj) => obj.id),
    ...nonWalkableObjects.map((obj) => obj.id),
    ...lavaObjects.map((obj) => obj.id),
    ...cliffObjects.map((obj) => obj.id),
    ...walkableObjects.map((obj) => obj.id),
  )

  return {
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    tilewidth: 1,
    tileheight: 1,
    orientation: "orthogonal",
    renderorder: "right-down",
    version: "1.10",
    tiledversion: "1.10.2",
    infinite: false,
    nextlayerid: 8,
    nextobjectid: highestObjectId + 1,
    tilesets: [],
    layers: [
      imageLayer(),
      objectLayer(2, "SpawnPoints", spawnObjects),
      objectLayer(3, "PropColliders", propObjects),
      objectLayer(4, "NonWalkableAreas", nonWalkableObjects),
      objectLayer(5, "LavaAreas", lavaObjects),
      objectLayer(6, "CliffAreas", cliffObjects),
      objectLayer(7, "WalkableAreas", walkableObjects),
    ],
  }
}

function layerRects(tilemap: TiledMap, layerName: string): Rect[] {
  const layer = tilemap.layers.find(
    (item): item is TiledObjectLayer => item.type === "objectgroup" && item.name === layerName,
  )
  return layer?.objects.map(({ x, y, width, height }) => ({ x, y, width, height })) ?? []
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

function buildGeneratedCollidersSource(
  tilemap: TiledMap,
  layerName: string,
  exportName: string,
): string {
  return `/**
 * AUTO-GENERATED by \`bun run build:arena-colliders\`. Do not edit by hand.
 * Source: public/assets/tilemaps/arena.json (object layer ${layerName}).
 */
export const ${exportName} = ${JSON.stringify(layerRects(tilemap, layerName), null, 2)} as const
`
}

function buildGeneratedHazardSource(
  tilemap: TiledMap,
  kind: "lava" | "cliff",
  exportName: string,
): string {
  const lava = layerRects(tilemap, "LavaAreas")
  const cliff = layerRects(tilemap, "CliffAreas")
  const rects =
    kind === "lava"
      ? lava
      : !hasGroundLayer(tilemap)
        ? cliff
      : [
          ...layerRects(tilemap, "NonWalkableAreas").filter(
            (rect) => !lava.some((lavaRect) => rectsOverlap(rect, lavaRect)),
          ),
          ...cliff,
        ]

  return `/**
 * AUTO-GENERATED by \`bun run build:arena-colliders\`. Do not edit by hand.
 * Source: public/assets/tilemaps/arena.json (${kind} hybrid hazard generation).
 */
export const ${exportName} = ${JSON.stringify(rects, null, 2)} as const
`
}

function hasGroundLayer(tilemap: TiledMap): boolean {
  return tilemap.layers.some((layer) => layer.type === "tilelayer" && layer.name === "Ground")
}

function buildGeneratedLavaTransitionSource(tilemap: TiledMap): string {
  const transition = lavaTransitionRectsFromNonWalkableAndLava(
    layerRects(tilemap, "NonWalkableAreas"),
    layerRects(tilemap, "LavaAreas"),
  )
  return `/**
 * AUTO-GENERATED by \`bun run build:arena-colliders\`. Do not edit by hand.
 * Source: public/assets/tilemaps/arena.json (NonWalkableAreas overlapping hybrid lava, boundary subset).
 */
export const GENERATED_ARENA_LAVA_TRANSITION_COLLIDERS = ${JSON.stringify(transition, null, 2)} as const
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
  const lavaCollidersSource = buildGeneratedHazardSource(
    tilemap,
    "lava",
    "GENERATED_ARENA_LAVA_COLLIDERS",
  )
  const cliffCollidersSource = buildGeneratedHazardSource(
    tilemap,
    "cliff",
    "GENERATED_ARENA_CLIFF_COLLIDERS",
  )
  const lavaTransitionSource = buildGeneratedLavaTransitionSource(tilemap)

  if (checkOnly) {
    assertSameFile(ARENA_JSON, tilemapSource)
    assertSameFile(GENERATED_COLLIDERS, propCollidersSource)
    assertSameFile(GENERATED_NON_WALKABLE_COLLIDERS, nonWalkableCollidersSource)
    assertSameFile(GENERATED_LAVA_COLLIDERS, lavaCollidersSource)
    assertSameFile(GENERATED_CLIFF_COLLIDERS, cliffCollidersSource)
    assertSameFile(GENERATED_LAVA_TRANSITION_COLLIDERS, lavaTransitionSource)
    console.log("Arena editor parity OK")
    return
  }

  writeFileSync(ARENA_JSON, tilemapSource, "utf8")
  writeFileSync(GENERATED_COLLIDERS, propCollidersSource, "utf8")
  writeFileSync(GENERATED_NON_WALKABLE_COLLIDERS, nonWalkableCollidersSource, "utf8")
  writeFileSync(GENERATED_LAVA_COLLIDERS, lavaCollidersSource, "utf8")
  writeFileSync(GENERATED_CLIFF_COLLIDERS, cliffCollidersSource, "utf8")
  writeFileSync(GENERATED_LAVA_TRANSITION_COLLIDERS, lavaTransitionSource, "utf8")
  console.log(`Wrote ${ARENA_JSON}`)
}

function main(): void {
  exportArenaTilemap(process.argv.includes("--check"))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
