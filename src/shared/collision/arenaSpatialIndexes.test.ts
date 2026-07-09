import { describe, expect, it } from "vitest"

import {
  ARENA_CLIFF_COLLIDERS,
  ARENA_LAVA_COLLIDERS,
  ARENA_PROP_COLLIDERS,
  ARENA_WORLD_COLLIDERS,
} from "@/shared/balance-config/arena"
import {
  JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX,
} from "@/shared/balance-config/combat"
import {
  AIRBORNE_COLLIDERS_WITH_LAVA_SET,
  ARENA_CLIFF_COLLIDER_SET,
  ARENA_LAVA_COLLIDER_SET,
  ARENA_PROP_COLLIDER_SET,
  ARENA_WORLD_COLLIDER_SET,
  terrainColliderSetForPlayerState,
} from "./arenaSpatialIndexes"

describe("arenaSpatialIndexes", () => {
  it("keeps indexed sets aligned with generated collider arrays", () => {
    expect(ARENA_WORLD_COLLIDER_SET.rects).toBe(ARENA_WORLD_COLLIDERS)
    expect(ARENA_LAVA_COLLIDER_SET.rects).toBe(ARENA_LAVA_COLLIDERS)
    expect(ARENA_CLIFF_COLLIDER_SET.rects).toBe(ARENA_CLIFF_COLLIDERS)
    expect(ARENA_CLIFF_COLLIDER_SET.rects).toHaveLength(0)
    expect(ARENA_PROP_COLLIDER_SET.rects).toBe(ARENA_PROP_COLLIDERS)
  })

  it("preserves source order for terrain-specific composite sets", () => {
    const lavaSet = terrainColliderSetForPlayerState(0, "lava")
    const cliffSet = terrainColliderSetForPlayerState(0, "cliff")

    expect(lavaSet.rects.slice(0, ARENA_PROP_COLLIDERS.length)).toEqual(ARENA_PROP_COLLIDERS)
    expect(cliffSet.rects.slice(0, ARENA_PROP_COLLIDERS.length)).toEqual(ARENA_PROP_COLLIDERS)
  })

  it("selects the same terrain collider sets as airborne lava rules", () => {
    expect(terrainColliderSetForPlayerState(0, "land")).toBe(ARENA_WORLD_COLLIDER_SET)
    expect(
      terrainColliderSetForPlayerState(JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX - 1, "land"),
    ).toBe(ARENA_PROP_COLLIDER_SET)
    expect(
      terrainColliderSetForPlayerState(JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX, "land"),
    ).toBe(AIRBORNE_COLLIDERS_WITH_LAVA_SET)
    expect(
      terrainColliderSetForPlayerState(JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX, "land", {
        jumpStartedInLava: true,
      }),
    ).toBe(ARENA_PROP_COLLIDER_SET)
  })
})
