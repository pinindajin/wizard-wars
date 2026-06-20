import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { buildArenaTilemapFromScene } from "../../../scripts/export-arena-tilemap"
import { ARENA_HEIGHT, ARENA_WIDTH } from "@/shared/balance-config/arena"
import { ARENA_NON_WALKABLE_COLLIDERS } from "@/shared/balance-config/arena"
import {
  rectCoverArea,
  rectCoverContainsPoint,
  type RectCover,
} from "../../../scripts/rect-cover-simplification"

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(TEST_DIR, "../../..")

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as T
}

type TiledObject = {
  readonly id: number
  readonly name: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

type TiledLayer = {
  readonly name: string
  readonly type: string
  readonly objects?: readonly TiledObject[]
}

function objectLayer(map: { readonly layers: readonly TiledLayer[] }, name: string): readonly TiledObject[] {
  const layer = map.layers.find((item) => item.type === "objectgroup" && item.name === name)
  if (!layer?.objects) throw new Error(`Expected object layer ${name}`)
  return layer.objects
}

function rectsOverlap(a: TiledObject, b: TiledObject): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

describe("Arena Phaser Editor scene", () => {
  it("exports to the committed arena tilemap without semantic drift", () => {
    const exported = buildArenaTilemapFromScene()
    const committed = readJson("public/assets/tilemaps/arena.json")

    expect(exported).toEqual(committed)
  })

  it("exports native prop colliders from editor-visible rectangles", () => {
    const exported = buildArenaTilemapFromScene()
    const propLayer = exported.layers.find(
      (layer) => layer.type === "objectgroup" && layer.name === "PropColliders",
    )

    if (!propLayer || propLayer.type !== "objectgroup") {
      throw new Error("Expected PropColliders object layer")
    }

    expect(propLayer.objects.length).toBeGreaterThan(0)
    expect(propLayer.objects[0]).toEqual(
      expect.objectContaining({
        name: "propCollider_000",
        type: "prop-collider",
      }),
    )
    for (const rect of propLayer.objects) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(ARENA_WIDTH)
      expect(rect.y + rect.height).toBeLessThanOrEqual(ARENA_HEIGHT)
      expect(rect.visible).toBe(true)
    }
  })

  it("exports non-walkable areas from Phaser Editor rectangles", () => {
    const exported = buildArenaTilemapFromScene()
    const nonWalkableLayer = exported.layers.find(
      (layer) => layer.type === "objectgroup" && layer.name === "NonWalkableAreas",
    )

    if (!nonWalkableLayer || nonWalkableLayer.type !== "objectgroup") {
      throw new Error("Expected NonWalkableAreas object layer")
    }

    expect(nonWalkableLayer.objects.length).toBeGreaterThan(0)
    expect(nonWalkableLayer.objects[0]).toEqual(
      expect.objectContaining({ name: "nonWalkableArea_000", type: "non-walkable-area" }),
    )
    for (const rect of nonWalkableLayer.objects) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(ARENA_WIDTH)
      expect(rect.y + rect.height).toBeLessThanOrEqual(ARENA_HEIGHT)
      expect(rect.visible).toBe(true)
    }
  })

  it("keeps generated non-walkable colliders as an exact simplified cover of editor rectangles", () => {
    const tilemap = readJson<{ readonly layers: readonly TiledLayer[] }>("public/assets/tilemaps/arena.json")
    const editorRects = objectLayer(tilemap, "NonWalkableAreas").map(({ x, y, width, height }) => ({
      x,
      y,
      width,
      height,
    }))

    expect(ARENA_NON_WALKABLE_COLLIDERS.length).toBeLessThan(editorRects.length)
    expect(rectCoverArea(ARENA_NON_WALKABLE_COLLIDERS)).toBe(rectCoverArea(editorRects))
    assertExactCoverParity(editorRects, ARENA_NON_WALKABLE_COLLIDERS)
  })

  it("exports unique object ids and mutually exclusive semantic region rectangles", () => {
    const tilemap = readJson<{ readonly layers: readonly TiledLayer[] }>("public/assets/tilemaps/arena.json")
    const ids = new Set<number>()
    for (const layer of tilemap.layers) {
      for (const object of layer.objects ?? []) {
        expect(ids.has(object.id), `${object.name} reuses object id ${object.id}`).toBe(false)
        ids.add(object.id)
      }
    }

    const pairs = [
      ["WalkableAreas", "LavaAreas"],
      ["WalkableAreas", "CliffAreas"],
      ["LavaAreas", "CliffAreas"],
    ] as const
    for (const [aName, bName] of pairs) {
      for (const a of objectLayer(tilemap, aName)) {
        for (const b of objectLayer(tilemap, bName)) {
          expect(rectsOverlap(a, b), `${a.name} overlaps ${b.name}`).toBe(false)
        }
      }
    }
  })

  it("uses Phaser Editor v5 native image data for Arena visuals and regions", () => {
    const scene = readJson<{
      readonly meta: { readonly version: number }
      readonly settings: {
        readonly exportClass: boolean
        readonly borderWidth: number
        readonly borderHeight: number
      }
      readonly displayList: readonly {
        readonly type: string
        readonly label: string
        readonly originX?: number
        readonly originY?: number
        readonly scaleX?: number
        readonly scaleY?: number
        readonly x?: number
        readonly y?: number
        readonly visible?: boolean
        readonly codexRuntimeExcluded?: boolean
        readonly texture?: { readonly key?: string }
      }[]
    }>("src/game/scenes/Arena.scene")
    const generatedSource = readFileSync(resolve(ROOT, "src/game/scenes/Arena.ts"), "utf8")

    expect(scene.meta.version).toBe(5)
    expect(scene.settings).toMatchObject({
      exportClass: false,
      borderWidth: ARENA_WIDTH,
      borderHeight: ARENA_HEIGHT,
    })
    expect(scene.displayList).toContainEqual(
      expect.objectContaining({
        type: "Image",
        label: "arena_base",
        texture: expect.objectContaining({ key: "arena-base" }),
      }),
    )
    expect(scene.displayList.some((item) => item.type === "Image" && item.label.startsWith("arena_prop_"))).toBe(true)
    expect(scene.displayList.some((item) => item.type === "Rectangle" && item.label.startsWith("propCollider_"))).toBe(true)
    expect(scene.displayList.some((item) => item.type === "Rectangle" && item.label.startsWith("lavaArea_"))).toBe(true)
    expect(scene.displayList.some((item) => item.type === "Rectangle" && item.label.startsWith("cliffArea_"))).toBe(true)
    expect(scene.displayList.some((item) => item.type === "Rectangle" && item.label.startsWith("walkableArea_"))).toBe(true)
    expect(
      scene.displayList
        .filter((item) => item.type === "Rectangle")
        .every((item) => item.visible === true),
    ).toBe(true)
    expect(
      scene.displayList
        .filter((item) => item.type === "Rectangle")
        .every((item) => item.codexRuntimeExcluded === true),
    ).toBe(true)
    expect(generatedSource).not.toContain("this.add.rectangle")
    expect(generatedSource).not.toContain("propCollider_")
    expect(generatedSource).not.toContain("lavaArea_")
    expect(generatedSource).not.toContain("cliffArea_")
    expect(generatedSource).not.toContain("walkableArea_")
  })

  it("anchors prop sprites at their ground contact point for y-sort occlusion", () => {
    const scene = readJson<{
      readonly displayList: readonly {
        readonly type: string
        readonly label: string
        readonly originX?: number
        readonly originY?: number
        readonly scaleX?: number
        readonly scaleY?: number
        readonly texture?: { readonly key?: string }
        readonly y?: number
      }[]
    }>("src/game/scenes/Arena.scene")
    const generatedSource = readFileSync(resolve(ROOT, "src/game/scenes/Arena.ts"), "utf8")
    const props = scene.displayList.filter(
      (item) => item.type === "Image" && item.label.startsWith("arena_prop_"),
    )

    expect(props.length).toBeGreaterThan(0)
    for (const prop of props) {
      expect(prop.originX).toBe(0.5)
      expect(prop.originY).toBe(1)
      expect(Math.abs(prop.scaleX ?? 0)).toBeGreaterThan(0)
      expect(Math.abs(prop.scaleY ?? 0)).toBeGreaterThan(0)
      expect(prop.texture?.key).toMatch(/^arena-prop-/)
      expect(generatedSource).toContain(`.setDepth(${prop.y})`)
    }
  })
})

/**
 * Checks exact half-open coverage over all cells induced by both covers' edges.
 *
 * @param original - Editor rectangle cover.
 * @param simplified - Generated simplified rectangle cover.
 */
function assertExactCoverParity(
  original: readonly RectCover[],
  simplified: readonly RectCover[],
): void {
  const xs = uniqueEdges(original, simplified, "x", "width")
  const ys = uniqueEdges(original, simplified, "y", "height")
  for (let yi = 0; yi < ys.length - 1; yi++) {
    for (let xi = 0; xi < xs.length - 1; xi++) {
      const x = (xs[xi]! + xs[xi + 1]!) / 2
      const y = (ys[yi]! + ys[yi + 1]!) / 2
      expect(rectCoverContainsPoint(simplified, x, y)).toBe(
        rectCoverContainsPoint(original, x, y),
      )
    }
  }
}

/**
 * Collects sorted unique rectangle edges for one axis.
 *
 * @param left - First cover.
 * @param right - Second cover.
 * @param originKey - Rectangle origin key.
 * @param sizeKey - Rectangle size key.
 * @returns Sorted unique edge coordinates.
 */
function uniqueEdges(
  left: readonly RectCover[],
  right: readonly RectCover[],
  originKey: "x" | "y",
  sizeKey: "width" | "height",
): number[] {
  const values = new Set<number>()
  for (const rect of [...left, ...right]) {
    values.add(rect[originKey])
    values.add(rect[originKey] + rect[sizeKey])
  }
  return [...values].sort((a, b) => a - b)
}
