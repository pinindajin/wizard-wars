import { describe, expect, it } from "vitest"

import {
  ARENA_CLIFF_COLLIDERS,
  ARENA_LAVA_COLLIDERS,
  ARENA_PROP_COLLIDERS,
  ARENA_WORLD_COLLIDERS,
} from "../balance-config/arena"
import { worldCollidersForPlayerState } from "./terrainHazards"

describe("worldCollidersForPlayerState", () => {
  it("blocks all hazards on land and excludes lava while in lava", () => {
    expect(worldCollidersForPlayerState(0, "land")).toBe(ARENA_WORLD_COLLIDERS)

    const lavaColliders = worldCollidersForPlayerState(0, "lava")
    expect(lavaColliders).not.toBe(ARENA_WORLD_COLLIDERS)
    expect(lavaColliders).not.toContain(ARENA_LAVA_COLLIDERS[0])
    expect(lavaColliders).toEqual(expect.arrayContaining([...ARENA_PROP_COLLIDERS]))
    expect(lavaColliders).toEqual(expect.arrayContaining([...ARENA_CLIFF_COLLIDERS]))
  })

  it("uses props only while airborne", () => {
    expect(worldCollidersForPlayerState(999, "lava")).toBe(ARENA_PROP_COLLIDERS)
  })
})
