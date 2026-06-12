import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { buildArenaTilemapFromScene } from "../../../scripts/export-arena-tilemap"
import { ARENA_HEIGHT, ARENA_WIDTH } from "@/shared/balance-config/arena"

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(TEST_DIR, "../../..")

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as T
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

  it("uses Phaser Editor v5 native image data for Arena visuals and regions", () => {
    const scene = readJson<{
      readonly meta: { readonly version: number }
      readonly settings: { readonly borderWidth: number; readonly borderHeight: number }
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
        readonly texture?: { readonly key?: string }
      }[]
    }>("src/game/scenes/Arena.scene")

    expect(scene.meta.version).toBe(5)
    expect(scene.settings).toMatchObject({ borderWidth: ARENA_WIDTH, borderHeight: ARENA_HEIGHT })
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
