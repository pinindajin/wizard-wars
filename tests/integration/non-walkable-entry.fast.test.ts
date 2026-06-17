import { describe, expect, it } from "vitest"

import { Position } from "@/server/game/components"
import { createGameSimulation } from "@/server/game/simulation"
import {
  ARENA_HEIGHT,
  ARENA_NON_WALKABLE_COLLIDERS,
  ARENA_WORLD_COLLIDERS,
  ARENA_WIDTH,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
  PLAYER_WORLD_COLLISION_OFFSET_Y_PX,
  PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
} from "@/shared/balance-config"
import { canOccupyWorldPosition } from "@/shared/collision/worldCollision"
import type { PlayerInputPayload } from "@/shared/types"

/**
 * Builds a complete player input payload for simulation tests.
 *
 * @param overrides - Input fields to override.
 * @returns Complete input payload.
 */
function input(overrides: Partial<PlayerInputPayload> = {}): PlayerInputPayload {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    abilitySlot: null,
    abilityTargetX: 0,
    abilityTargetY: 0,
    weaponPrimary: false,
    weaponSecondary: false,
    weaponTargetX: 0,
    weaponTargetY: 0,
    useQuickItemSlot: null,
    seq: 1,
    clientSendTimeMs: Date.now(),
    ...overrides,
  }
}

/**
 * Wraps a single input in the queue shape consumed by `tick`.
 *
 * @param payload - Player input payload.
 * @returns Per-player input queue map.
 */
function queue(payload: PlayerInputPayload): Map<string, PlayerInputPayload[]> {
  return new Map([["user1", [payload]]])
}

function sampleUpperBlocker(): { x: number; y: number; minY: number } {
  const bounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }
  const topClearance = PLAYER_WORLD_COLLISION_RADIUS_Y_PX - PLAYER_WORLD_COLLISION_OFFSET_Y_PX
  const blocker = ARENA_NON_WALKABLE_COLLIDERS
    .filter((rect) => {
      if (rect.y >= 420) return false
      const x = rect.x + rect.width / 2
      const y = rect.y + rect.height + topClearance + 3
      return canOccupyWorldPosition(
        x,
        y,
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        bounds,
        ARENA_WORLD_COLLIDERS,
      )
    })
    .sort((a, b) => b.width * b.height - a.width * a.height)[0]
  if (blocker) {
    const rect = blocker
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height + topClearance + 3
    return { x, y, minY: rect.y + rect.height + topClearance }
  }
  throw new Error("expected upper native non-walkable blocker with legal start")
}

describe("non-walkable movement integration", () => {
  it("keeps authoritative snapshots outside editor-authored non-walkable colliders", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const start = sampleUpperBlocker()
    const bounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

    Position.x[eid] = start.x
    Position.y[eid] = start.y

    sim.tick(queue(input({ up: true })), Date.now())

    const snap = sim.buildGameStateSyncPayload(Date.now()).players[0]!
    expect(snap.y).toBeGreaterThanOrEqual(start.minY)
    expect(snap.vy).toBe(0)
    expect(
      canOccupyWorldPosition(
        snap.x,
        snap.y,
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        bounds,
        ARENA_WORLD_COLLIDERS,
      ),
    ).toBe(true)
  })
})
