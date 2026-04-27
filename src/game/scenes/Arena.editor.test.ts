import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { buildArenaTilemapFromScene } from "../../../scripts/export-arena-tilemap"

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

  it("keeps current prop collider gameplay empty until editor props are intentionally added", () => {
    const exported = buildArenaTilemapFromScene()
    const propLayer = exported.layers.find(
      (layer) => layer.type === "objectgroup" && layer.name === "PropColliders",
    )

    if (!propLayer || propLayer.type !== "objectgroup") {
      throw new Error("Expected PropColliders object layer")
    }

    expect(propLayer.objects).toEqual([])
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
    expect(nonWalkableLayer.objects).toContainEqual(
      expect.objectContaining({
        name: "nonWalkableArea_000",
        type: "non-walkable-area",
        x: 0,
        y: 0,
        width: 4224,
        height: 128,
      }),
    )
  })

  it("uses Phaser Editor v5 editable tilemap data for Arena visuals", () => {
    const scene = readJson<{
      readonly meta: { readonly version: number }
      readonly displayList: readonly { readonly type: string; readonly label: string }[]
      readonly plainObjects: readonly { readonly type: string; readonly label: string }[]
    }>("src/game/scenes/Arena.scene")

    expect(scene.meta.version).toBe(5)
    expect(scene.plainObjects).toContainEqual(
      expect.objectContaining({ type: "EditableTilemap", label: "arenaMap" }),
    )
    expect(scene.displayList).toContainEqual(
      expect.objectContaining({ type: "EditableTilemapLayer", label: "Ground" }),
    )
    expect(scene.displayList).toContainEqual(
      expect.objectContaining({ type: "Rectangle", label: "nonWalkableArea_000" }),
    )
  })
})
