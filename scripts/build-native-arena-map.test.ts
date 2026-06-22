import { describe, expect, it } from "vitest"

import {
  assetEntries,
  isBuildNativeArenaMapCliEntrypoint,
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

describe("native arena builder CLI guard", () => {
  it("detects direct execution by script path", () => {
    const scriptPath = "/repo/scripts/build-native-arena-map.ts"

    expect(isBuildNativeArenaMapCliEntrypoint(["bun", scriptPath], `file://${scriptPath}`)).toBe(true)
    expect(isBuildNativeArenaMapCliEntrypoint(["bun"], `file://${scriptPath}`)).toBe(false)
  })
})
