import { describe, expect, it } from "vitest"

import {
  buildGeneratedCollidersSource,
  type TiledMap,
} from "./export-arena-tilemap"

describe("buildGeneratedCollidersSource", () => {
  it("simplifies generated non-walkable collider source", () => {
    const source = buildGeneratedCollidersSource(
      tilemapWithLayer("NonWalkableAreas", [
        { x: 0, y: 0, width: 4, height: 4 },
        { x: 4, y: 0, width: 4, height: 4 },
      ]),
      "NonWalkableAreas",
      "GENERATED",
    )

    expect(source).toContain('"width": 8')
    expect(source).not.toContain('"x": 4')
  })

  it("preserves generated prop collider source literally", () => {
    const source = buildGeneratedCollidersSource(
      tilemapWithLayer("PropColliders", [
        { x: 0, y: 0, width: 4, height: 4 },
        { x: 4, y: 0, width: 4, height: 4 },
      ]),
      "PropColliders",
      "GENERATED",
    )

    expect(source).toContain('"width": 4')
    expect(source).toContain('"x": 4')
  })

  it("emits an empty array for a missing object layer", () => {
    expect(buildGeneratedCollidersSource(tilemapWithLayer("Other", []), "Missing", "GENERATED")).toContain(
      "[] as const",
    )
  })
})

/**
 * Builds a minimal Tiled map fixture with one object layer.
 *
 * @param name - Object layer name.
 * @param rects - Rectangle objects for the layer.
 * @returns Minimal tilemap fixture.
 */
function tilemapWithLayer(
  name: string,
  rects: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[],
): TiledMap {
  return {
    width: 16,
    height: 16,
    tilewidth: 1,
    tileheight: 1,
    orientation: "orthogonal",
    renderorder: "right-down",
    version: "1.10",
    tiledversion: "1.10.2",
    infinite: false,
    nextlayerid: 2,
    nextobjectid: 100 + rects.length,
    tilesets: [],
    layers: [
      {
        id: 1,
        name,
        type: "objectgroup",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        draworder: "topdown",
        objects: rects.map((rect, index) => ({
          id: 100 + index,
          name: `${name}_${index}`,
          type: "test",
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          visible: true,
        })),
      },
    ],
  }
}
