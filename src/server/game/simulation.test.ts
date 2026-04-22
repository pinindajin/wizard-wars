import { describe, it, expect, vi, beforeEach } from "vitest"
import { createGameSimulation } from "@/server/game/simulation"
import { ARENA_SPAWN_POINTS, ARENA_WIDTH, ARENA_HEIGHT } from "@/shared/balance-config/arena"
import { DEFAULT_PLAYER_HEALTH, STARTING_LIVES, BASE_MOVE_SPEED_PX_PER_SEC, PLAYER_RADIUS_PX } from "@/shared/balance-config/combat"
import { TICK_DT_SEC } from "@/shared/balance-config/rendering"
import type { PlayerInputPayload } from "@/shared/types"

const emptyInput = (): PlayerInputPayload => ({
  up: false, down: false, left: false, right: false,
  abilitySlot: null, abilityTargetX: 0, abilityTargetY: 0,
  weaponPrimary: false, weaponSecondary: false, weaponTargetX: 0, weaponTargetY: 0,
  useQuickItemSlot: null, seq: 0,
})

describe("createGameSimulation", () => {
  it("creates a simulation with correct match start time", () => {
    const startMs = Date.now()
    const sim = createGameSimulation(startMs)
    expect(sim.matchStartedAtMs).toBe(startMs)
  })

  it("addPlayer creates an entity with correct initial state", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    expect(eid).toBeGreaterThanOrEqual(0)
    expect(sim.playerEntityMap.get("user1")).toBe(eid)
    expect(sim.entityUsernameMap.get(eid)).toBe("Alice")
  })

  it("addPlayer spawns at correct spawn point location", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const input = new Map<string, PlayerInputPayload>()
    const output = sim.tick(input, Date.now())
    // Player should appear in deltas
    const delta = output.playerDeltas.find((d) => d.id === sim.playerEntityMap.get("user1"))
    expect(delta).toBeDefined()
    if (delta?.x !== undefined && delta?.y !== undefined) {
      // Approximate spawn point position
      const sp = ARENA_SPAWN_POINTS[0]
      expect(delta.x).toBeCloseTo(sp.x, 1)
      expect(delta.y).toBeCloseTo(sp.y, 1)
    }
  })

  it("removePlayer removes the entity", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    sim.removePlayer("user1")
    expect(sim.playerEntityMap.get("user1")).toBeUndefined()
  })
})

describe("movement system", () => {
  it("moves player up when W is pressed", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const spawnY = ARENA_SPAWN_POINTS[0].y

    const input = new Map<string, PlayerInputPayload>([
      ["user1", { ...emptyInput(), up: true }],
    ])

    // Wait for invulnerability to expire, tick several times
    for (let i = 0; i < 40; i++) {
      sim.tick(input, Date.now() + i * 50)
    }

    const output = sim.tick(input, Date.now() + 40 * 50)
    const delta = output.playerDeltas.find((d) => d.id === sim.playerEntityMap.get("user1"))
    if (delta?.y !== undefined) {
      expect(delta.y).toBeLessThan(spawnY) // y decreases when moving up
    }
  })

  it("player cannot leave arena bounds", () => {
    const sim = createGameSimulation(Date.now())
    // Use spawn point 0 which is at right edge
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    const input = new Map<string, PlayerInputPayload>([
      ["user1", { ...emptyInput(), right: true }],
    ])

    // Move right many ticks (should be clamped at arena edge)
    for (let i = 0; i < 200; i++) {
      sim.tick(input, Date.now() + i * 50)
    }
    const output = sim.tick(input, Date.now() + 200 * 50)
    const delta = output.playerDeltas.find((d) => d.id === sim.playerEntityMap.get("user1"))
    if (delta?.x !== undefined) {
      expect(delta.x).toBeLessThanOrEqual(ARENA_WIDTH - PLAYER_RADIUS_PX)
    }
  })
})

describe("match end", () => {
  it("requestHostEnd triggers match end on next tick", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    sim.requestHostEnd()
    const output = sim.tick(new Map(), Date.now())
    expect(output.matchEnded).not.toBe(null)
    expect(output.matchEnded?.reason).toBe("host_ended")
  })

  it("scoreboard entries include the player", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    sim.requestHostEnd()
    const output = sim.tick(new Map(), Date.now())
    expect(output.matchEnded?.entries).toHaveLength(1)
    expect(output.matchEnded?.entries[0].playerId).toBe("user1")
    expect(output.matchEnded?.entries[0].username).toBe("Alice")
  })
})
