import { describe, expect, it } from "vitest"

import { Position } from "@/server/game/components"
import { createGameSimulation } from "@/server/game/simulation"
import { ARENA_SPAWN_POINTS } from "@/shared/balance-config"
import type { PlayerInputPayload } from "@/shared/types"

function input(seq: number, overrides: Partial<PlayerInputPayload> = {}): PlayerInputPayload {
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
    seq,
    clientSendTimeMs: 0,
    ...overrides,
  }
}

describe("spatial-index-backed simulation paths", () => {
  it("keeps a full 12-player simulation producing authoritative deltas", () => {
    const sim = createGameSimulation(0)
    for (let i = 0; i < 12; i++) {
      sim.addPlayer(`p${i}`, `Player ${i}`, "red_wizard", i)
    }

    const output = sim.tick(new Map(), 0)

    expect(output.playerDeltas).toHaveLength(12)
    expect(output.matchEnded).toBeNull()
  })

  it("moves a spread player near cell boundaries without false-positive blocking", () => {
    const sim = createGameSimulation(0)
    const eid = sim.addPlayer("p0", "Player 0", "red_wizard", 0)
    const spawn = ARENA_SPAWN_POINTS[0]!
    Position.x[eid] = spawn.x
    Position.y[eid] = spawn.y

    const beforeX = Position.x[eid]
    const output = sim.tick(
      new Map([[
        "p0",
        [input(0, { right: true, weaponTargetX: beforeX + 200, weaponTargetY: Position.y[eid] })],
      ]]),
      1,
    )

    expect(Position.x[eid]).toBeGreaterThan(beforeX)
    expect(output.playerDeltas.some((delta) => delta.id === eid && delta.x !== undefined)).toBe(
      true,
    )
  })
})
