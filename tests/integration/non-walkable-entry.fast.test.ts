import { describe, expect, it } from "vitest"

import { Position } from "@/server/game/components"
import { createGameSimulation } from "@/server/game/simulation"
import {
  ARENA_HEIGHT,
  ARENA_WORLD_COLLIDERS,
  ARENA_WIDTH,
  PLAYER_RADIUS_PX,
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

describe("non-walkable movement integration", () => {
  it("keeps authoritative snapshots outside editor-authored non-walkable colliders", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const topStrip = ARENA_WORLD_COLLIDERS[0]!
    const bounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

    Position.x[eid] = topStrip.x + 704
    Position.y[eid] = topStrip.y + topStrip.height + PLAYER_RADIUS_PX

    sim.tick(queue(input({ up: true })), Date.now())

    const snap = sim.buildGameStateSyncPayload(Date.now()).players[0]!
    expect(snap.y).toBe(topStrip.y + topStrip.height + PLAYER_RADIUS_PX)
    expect(snap.vy).toBe(0)
    expect(
      canOccupyWorldPosition(
        snap.x,
        snap.y,
        PLAYER_RADIUS_PX,
        bounds,
        ARENA_WORLD_COLLIDERS,
      ),
    ).toBe(true)
  })
})
