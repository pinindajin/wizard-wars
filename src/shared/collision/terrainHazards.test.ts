import { describe, expect, it } from "vitest"

import {
  ARENA_CLIFF_COLLIDERS,
  ARENA_LAVA_COLLIDERS,
  ARENA_LAVA_TRANSITION_COLLIDERS,
  ARENA_NON_HAZARD_COLLIDERS,
  ARENA_PROP_COLLIDERS,
  ARENA_WORLD_COLLIDERS,
} from "../balance-config/arena"
import {
  nearestLavaCenter,
  pointInRects,
  rectsOverlap,
  terrainStateAtPosition,
  worldCollidersForPlayerState,
} from "./terrainHazards"
import type { ArenaPropColliderRect } from "./worldCollision"

const rect: ArenaPropColliderRect = { x: 10, y: 20, width: 30, height: 40 }

describe("terrain geometry helpers", () => {
  it("detects rectangle overlap and separation on each axis", () => {
    expect(rectsOverlap(rect, { x: 39, y: 59, width: 10, height: 10 })).toBe(true)
    expect(rectsOverlap(rect, { x: 40, y: 30, width: 10, height: 10 })).toBe(false)
    expect(rectsOverlap(rect, { x: -1, y: 30, width: 10, height: 10 })).toBe(false)
    expect(rectsOverlap(rect, { x: 20, y: 60, width: 10, height: 10 })).toBe(false)
    expect(rectsOverlap(rect, { x: 20, y: 9, width: 10, height: 10 })).toBe(false)
  })

  it("samples points and terrain states from hazard colliders", () => {
    const lava = ARENA_LAVA_COLLIDERS[0]
    const cliff = ARENA_CLIFF_COLLIDERS[0]

    expect(pointInRects(lava.x, lava.y, ARENA_LAVA_COLLIDERS)).toBe(true)
    expect(pointInRects(-1, -1, ARENA_LAVA_COLLIDERS)).toBe(false)
    expect(terrainStateAtPosition(lava.x + 1, lava.y + 1)).toBe("lava")
    expect(terrainStateAtPosition(cliff.x + 1, cliff.y + 1)).toBe("cliff")
    expect(terrainStateAtPosition(0, 0)).toBe("land")
  })

  it("returns the nearest lava center", () => {
    const lava = ARENA_LAVA_COLLIDERS[0]
    const center = {
      x: lava.x + lava.width / 2,
      y: lava.y + lava.height / 2,
    }

    expect(nearestLavaCenter(center.x, center.y)).toEqual(center)
  })
})

describe("worldCollidersForPlayerState", () => {
  it("blocks all hazards on land and submerged lava path adds transition strips", () => {
    expect(worldCollidersForPlayerState(0, "land")).toBe(ARENA_WORLD_COLLIDERS)

    const lavaColliders = worldCollidersForPlayerState(0, "lava")
    expect(lavaColliders).not.toBe(ARENA_WORLD_COLLIDERS)
    expect(lavaColliders).not.toContain(ARENA_LAVA_COLLIDERS[0])
    expect(lavaColliders).toEqual(expect.arrayContaining([...ARENA_PROP_COLLIDERS]))
    expect(lavaColliders).toEqual(expect.arrayContaining([...ARENA_CLIFF_COLLIDERS]))
    if (ARENA_LAVA_TRANSITION_COLLIDERS.length > 0) {
      expect(lavaColliders).toEqual(
        expect.arrayContaining([...ARENA_LAVA_TRANSITION_COLLIDERS]),
      )
    }
  })

  it("uses props only in the last ticks of an arc (low jumpZ) from land", () => {
    expect(worldCollidersForPlayerState(3, "lava")).toBe(ARENA_PROP_COLLIDERS)
  })

  it("uses props only mid-arc from land when below lava-collision height", () => {
    expect(worldCollidersForPlayerState(50, "lava")).toBe(ARENA_PROP_COLLIDERS)
  })

  it("uses props plus lava only near apex from land (tightens wide gap skims)", () => {
    const c = worldCollidersForPlayerState(90, "lava")
    expect(c).toEqual(expect.arrayContaining([...ARENA_PROP_COLLIDERS]))
    expect(c).toEqual(expect.arrayContaining([...ARENA_LAVA_COLLIDERS]))
  })

  it("uses props only while airborne escape jump from lava", () => {
    expect(
      worldCollidersForPlayerState(3, "land", { jumpStartedInLava: true }),
    ).toBe(ARENA_PROP_COLLIDERS)
  })

  it("excludes cliff colliders while already stumbling on a cliff", () => {
    const cliffColliders = worldCollidersForPlayerState(0, "cliff")

    expect(cliffColliders).not.toBe(ARENA_WORLD_COLLIDERS)
    expect(cliffColliders).toEqual(expect.arrayContaining([...ARENA_PROP_COLLIDERS]))
    expect(cliffColliders).toEqual(expect.arrayContaining([...ARENA_NON_HAZARD_COLLIDERS]))
    expect(cliffColliders).not.toContain(ARENA_CLIFF_COLLIDERS[0])
    expect(cliffColliders).not.toContain(ARENA_LAVA_COLLIDERS[0])
  })
})
