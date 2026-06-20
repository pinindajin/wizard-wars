import { describe, expect, it } from "vitest"

import {
  buildColliderSource,
  isCompileArenaCollidersCliEntrypoint,
} from "./compile-arena-colliders"

describe("buildColliderSource", () => {
  it("simplifies generated non-walkable colliders", () => {
    const source = buildColliderSource("NonWalkableAreas", "GENERATED", [
      { x: 0, y: 0, width: 4, height: 4 },
      { x: 4, y: 0, width: 4, height: 4 },
    ])

    expect(source).toContain('"width": 8')
    expect(source).not.toContain('"x": 4')
  })

  it("preserves non-world-collision object layers literally", () => {
    const source = buildColliderSource("PropColliders", "GENERATED", [
      { x: 0, y: 0, width: 4, height: 4 },
      { x: 4, y: 0, width: 4, height: 4 },
    ])

    expect(source).toContain('"width": 4')
    expect(source).toContain('"x": 4')
  })
})

describe("compile arena colliders CLI guard", () => {
  it("detects direct execution by script path", () => {
    const scriptPath = "/repo/scripts/compile-arena-colliders.ts"

    expect(isCompileArenaCollidersCliEntrypoint(["bun", scriptPath], `file://${scriptPath}`)).toBe(true)
    expect(isCompileArenaCollidersCliEntrypoint(["bun"], `file://${scriptPath}`)).toBe(false)
  })
})
