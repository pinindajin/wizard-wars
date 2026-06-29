import { describe, expect, it } from "vitest"

import {
  ARENA_OUTPUT_COLS,
  ARENA_OUTPUT_HEIGHT,
  ARENA_OUTPUT_ROWS,
  ARENA_OUTPUT_SCALE,
  ARENA_OUTPUT_WIDTH,
  assetEntries,
  isBuildNativeArenaMapCliEntrypoint,
  scaleArenaOutputPlacement,
  scaleArenaOutputRect,
} from "./build-native-arena-map"

describe("native arena asset entries", () => {
  it("omits the editor tilemap from runtime asset packs", () => {
    const entries = assetEntries([{ id: "obelisk" }], true)

    expect(entries).toContainEqual({
      type: "image",
      key: "arena-base",
      url: "/assets/maps/arena-base.png",
    })
    expect(entries).toContainEqual({
      type: "image",
      key: "arena-prop-obelisk",
      url: "/assets/sprites/arena-props/obelisk.png",
    })
    expect(entries.some((entry) => entry.type === "tilemapTiledJSON")).toBe(false)
  })

  it("keeps the project-relative editor tilemap entry for Phaser Editor", () => {
    expect(assetEntries([], false)).toContainEqual({
      type: "tilemapTiledJSON",
      key: "arena",
      url: "assets/tilemaps/arena.json",
    })
  })
})

describe("native arena output scale", () => {
  it("emits doubled runtime dimensions from source-space art", () => {
    expect(ARENA_OUTPUT_SCALE).toBe(2)
    expect(ARENA_OUTPUT_WIDTH).toBe(2804)
    expect(ARENA_OUTPUT_HEIGHT).toBe(2244)
    expect(ARENA_OUTPUT_COLS).toBe(44)
    expect(ARENA_OUTPUT_ROWS).toBe(36)
  })

  it("scales source-space rectangles and placements for generated runtime data", () => {
    expect(scaleArenaOutputRect({ x: 10, y: 12, width: 30, height: 40 })).toEqual({
      x: 20,
      y: 24,
      width: 60,
      height: 80,
    })

    expect(scaleArenaOutputPlacement({ propId: "obelisk", x: 100, y: 120, scale: 0.25, flipX: true })).toEqual({
      propId: "obelisk",
      x: 200,
      y: 240,
      scale: 0.5,
      flipX: true,
    })
  })
})

describe("native arena builder CLI guard", () => {
  it("detects direct execution by script path", () => {
    const scriptPath = "/repo/scripts/build-native-arena-map.ts"

    expect(isBuildNativeArenaMapCliEntrypoint(["bun", scriptPath], `file://${scriptPath}`)).toBe(true)
    expect(isBuildNativeArenaMapCliEntrypoint(["bun"], `file://${scriptPath}`)).toBe(false)
  })
})
