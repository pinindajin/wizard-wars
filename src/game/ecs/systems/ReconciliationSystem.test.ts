import { describe, expect, it } from "vitest"

import { LocalInputHistory } from "../../network/LocalInputHistory"
import { reconcileLocal } from "./ReconciliationSystem"
import {
  ARENA_HEIGHT,
  ARENA_SPAWN_POINTS,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
  PLAYER_RADIUS_PX,
} from "@/shared/balance-config"
import { resolveAgainstWorld } from "@/shared/collision/worldCollision"
import type { PlayerInputPayload } from "@/shared/types"

function input(over: Partial<PlayerInputPayload> & { seq: number }): PlayerInputPayload {
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
    clientSendTimeMs: 0,
    ...over,
  }
}

const noopCtx = {
  isSwinging: false,
  hasSwiftBoots: false,
  castingAbilityId: null,
} as const

const arenaBounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

function findRightwardReplayStart(): { x: number; y: number } {
  const start = ARENA_SPAWN_POINTS.find((point) => {
    const probeX = point.x + PLAYER_RADIUS_PX
    const resolved = resolveAgainstWorld(
      probeX,
      point.y,
      PLAYER_RADIUS_PX,
      arenaBounds,
      ARENA_WORLD_COLLIDERS,
    )
    return Math.abs(resolved.x - probeX) < 0.001 && Math.abs(resolved.y - point.y) < 0.001
  })
  if (!start) throw new Error("Expected at least one spawn with rightward replay clearance.")
  return start
}

describe("reconcileLocal", () => {
  it("reports no visible correction when prediction matches ack", () => {
    const history = new LocalInputHistory()
    const ack = { x: 500, y: 500, lastProcessedInputSeq: 0 }
    const currentRender = { x: 500, y: 500 }

    const r = reconcileLocal(ack, history, currentRender, noopCtx)
    expect(r.correction).toBe("none")
    expect(r.renderX).toBe(500)
    expect(r.renderY).toBe(500)
  })

  it("classifies a medium error as 'smooth'", () => {
    const history = new LocalInputHistory()
    const ack = { x: 500, y: 500, lastProcessedInputSeq: 0 }
    const currentRender = { x: 510, y: 500 }

    const r = reconcileLocal(ack, history, currentRender, noopCtx)
    expect(r.correction).toBe("smooth")
    expect(r.targetX).toBe(500)
  })

  it("snaps when the error exceeds the snap threshold", () => {
    const history = new LocalInputHistory()
    const ack = { x: 500, y: 500, lastProcessedInputSeq: 0 }
    const currentRender = { x: 700, y: 500 }

    const r = reconcileLocal(ack, history, currentRender, noopCtx)
    expect(r.correction).toBe("snap")
    expect(r.renderX).toBe(500)
  })

  it("discards inputs with seq <= ack.lastProcessedInputSeq", () => {
    const history = new LocalInputHistory()
    history.append(input({ seq: 5, right: true }))
    history.append(input({ seq: 6, right: true }))

    const ack = { x: 500, y: 500, lastProcessedInputSeq: 6 }
    reconcileLocal(ack, history, { x: 500, y: 500 }, noopCtx)
    expect(history.size()).toBe(0)
  })

  it("replays pending inputs through movement + collision to produce the target", () => {
    const history = new LocalInputHistory()
    // Three "right" inputs after the ack.
    history.append(input({ seq: 10, right: true }))
    history.append(input({ seq: 11, right: true }))
    history.append(input({ seq: 12, right: true }))

    const start = findRightwardReplayStart()
    const ack = { x: start.x, y: start.y, lastProcessedInputSeq: 9 }
    // Current render reflects the same pending path (predicted correctly).
    const r = reconcileLocal(ack, history, start, noopCtx)

    // Expected: moved right by 3 ticks at BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC.
    expect(r.targetX).toBeGreaterThan(start.x)
    expect(r.targetY).toBeCloseTo(start.y, 5)
    // Render should have moved to match the replay target.
    expect(r.renderX).toBeCloseTo(r.targetX, 5)
  })
})
