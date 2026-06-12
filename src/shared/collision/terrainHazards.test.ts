import { describe, expect, it } from "vitest"

import {
  ARENA_CLIFF_COLLIDERS,
  ARENA_HEIGHT,
  ARENA_LAVA_COLLIDERS,
  ARENA_LAVA_TRANSITION_COLLIDERS,
  ARENA_NON_HAZARD_COLLIDERS,
  ARENA_PROP_COLLIDERS,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
} from "../balance-config/arena"
import { PLAYER_WORLD_COLLISION_FOOTPRINT } from "../balance-config/combat"
import {
  groundedLavaCandidateCanOccupy,
  nearestLavaCenter,
  pointInRects,
  rectsOverlap,
  terrainStateAtPosition,
  worldCollidersForPlayerState,
} from "./terrainHazards"
import { canOccupyWorldPosition, type ArenaPropColliderRect } from "./worldCollision"

const rect: ArenaPropColliderRect = { x: 10, y: 20, width: 30, height: 40 }
const OPEN_LAND_POINT = { x: 710, y: 562 }

function sampleWideLavaRect(): ArenaPropColliderRect {
  const lava = ARENA_LAVA_COLLIDERS.find((candidate) =>
    candidate.width >= 250 &&
    candidate.height >= 100 &&
    terrainStateAtPosition(
      candidate.x + candidate.width / 2,
      candidate.y + candidate.height / 2,
    ) === "lava",
  )
  if (!lava) throw new Error("Expected a wide native lava rectangle")
  return lava
}

function sampleCliffOnlyRect(): ArenaPropColliderRect {
  const cliff = ARENA_CLIFF_COLLIDERS.find((candidate) =>
    terrainStateAtPosition(
      candidate.x + candidate.width / 2,
      candidate.y + candidate.height / 2,
    ) === "cliff",
  )
  if (!cliff) throw new Error("Expected a native cliff rectangle outside lava")
  return cliff
}

describe("terrain geometry helpers", () => {
  it("detects rectangle overlap and separation on each axis", () => {
    expect(rectsOverlap(rect, { x: 39, y: 59, width: 10, height: 10 })).toBe(true)
    expect(rectsOverlap(rect, { x: 40, y: 30, width: 10, height: 10 })).toBe(false)
    expect(rectsOverlap(rect, { x: -1, y: 30, width: 10, height: 10 })).toBe(false)
    expect(rectsOverlap(rect, { x: 20, y: 60, width: 10, height: 10 })).toBe(false)
    expect(rectsOverlap(rect, { x: 20, y: 9, width: 10, height: 10 })).toBe(false)
  })

  it("samples points and terrain states from hazard colliders", () => {
    const lava = sampleWideLavaRect()
    const cliff = sampleCliffOnlyRect()

    expect(pointInRects(lava.x, lava.y, ARENA_LAVA_COLLIDERS)).toBe(true)
    expect(pointInRects(-1, -1, ARENA_LAVA_COLLIDERS)).toBe(false)
    expect(terrainStateAtPosition(lava.x + 1, lava.y + 1)).toBe("lava")
    expect(terrainStateAtPosition(cliff.x + cliff.width / 2, cliff.y + cliff.height / 2)).toBe(
      "cliff",
    )
    expect(terrainStateAtPosition(OPEN_LAND_POINT.x, OPEN_LAND_POINT.y)).toBe("land")
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
  it("blocks all hazards on land and submerged lava path does not eject valid lava", () => {
    expect(worldCollidersForPlayerState(0, "land")).toBe(ARENA_WORLD_COLLIDERS)

    const lavaColliders = worldCollidersForPlayerState(0, "lava")
    expect(lavaColliders).not.toBe(ARENA_WORLD_COLLIDERS)
    expect(lavaColliders).not.toContain(ARENA_LAVA_COLLIDERS[0])
    expect(lavaColliders).toEqual(expect.arrayContaining([...ARENA_PROP_COLLIDERS]))
    expect(lavaColliders).toEqual(expect.arrayContaining([...ARENA_CLIFF_COLLIDERS]))
    if (ARENA_LAVA_TRANSITION_COLLIDERS.length > 0) {
      expect(lavaColliders).not.toContain(ARENA_LAVA_TRANSITION_COLLIDERS[0])
    }

    const lava = sampleWideLavaRect()
    const lavaCenter = {
      x: lava.x + lava.width / 2,
      y: lava.y + lava.height / 2,
    }
    const bounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }
    expect(
      canOccupyWorldPosition(
        lavaCenter.x,
        lavaCenter.y,
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        bounds,
        lavaColliders,
      ),
    ).toBe(true)
    expect(groundedLavaCandidateCanOccupy(lavaCenter.x, lavaCenter.y)).toBe(true)
    expect(groundedLavaCandidateCanOccupy(OPEN_LAND_POINT.x, OPEN_LAND_POINT.y)).toBe(false)
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
