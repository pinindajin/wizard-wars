import { describe, it, expect } from "vitest"
import { createGameSimulation } from "@/server/game/simulation"
import { ARENA_SPAWN_POINTS, ARENA_WIDTH } from "@/shared/balance-config/arena"
import { PLAYER_RADIUS_PX } from "@/shared/balance-config/combat"
import type { PlayerInputPayload } from "@/shared/types"

let nextSeq = 1
const emptyInput = (overrides: Partial<PlayerInputPayload> = {}): PlayerInputPayload => ({
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
  seq: nextSeq++,
  clientSendTimeMs: Date.now(),
  ...overrides,
})

/** Convenience: wrap a single input per player into the new queue-style map. */
function queueMap(
  entries: Array<[string, PlayerInputPayload]>,
): Map<string, PlayerInputPayload[]> {
  const out = new Map<string, PlayerInputPayload[]>()
  for (const [userId, input] of entries) {
    out.set(userId, [input])
  }
  return out
}

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
    const output = sim.tick(new Map(), Date.now())
    const delta = output.playerDeltas.find((d) => d.id === sim.playerEntityMap.get("user1"))
    expect(delta).toBeDefined()
    if (delta?.x !== undefined && delta?.y !== undefined) {
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
  it("moves player up when W is pressed across many ticks", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const spawnY = ARENA_SPAWN_POINTS[0].y

    let lastY = spawnY
    for (let i = 0; i < 40; i++) {
      const output = sim.tick(
        queueMap([["user1", emptyInput({ up: true })]]),
        Date.now() + i * 17,
      )
      const delta = output.playerDeltas.find((d) => d.id === sim.playerEntityMap.get("user1"))
      if (delta?.y !== undefined) lastY = delta.y
    }

    expect(lastY).toBeLessThan(spawnY)
  })

  it("player cannot leave arena bounds", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    let lastX = -Infinity
    for (let i = 0; i < 400; i++) {
      const output = sim.tick(
        queueMap([["user1", emptyInput({ right: true })]]),
        Date.now() + i * 17,
      )
      const delta = output.playerDeltas.find((d) => d.id === sim.playerEntityMap.get("user1"))
      if (delta?.x !== undefined) lastX = delta.x
    }

    expect(lastX).toBeLessThanOrEqual(ARENA_WIDTH - PLAYER_RADIUS_PX)
  })

  it("consumes queued inputs one per tick in seq order", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    // Seed three queued inputs (all moving up) and verify lastProcessedInputSeq
    // increments one per tick.
    const queues = new Map<string, PlayerInputPayload[]>()
    queues.set("user1", [
      { ...emptyInput({ up: true }), seq: 100 },
      { ...emptyInput({ up: true }), seq: 101 },
      { ...emptyInput({ up: true }), seq: 102 },
    ])

    const out1 = sim.tick(queues, Date.now())
    const out2 = sim.tick(queues, Date.now() + 17)
    const out3 = sim.tick(queues, Date.now() + 34)

    const acks = [out1, out2, out3].map((o) =>
      o.playerDeltas.find((d) => d.id === sim.playerEntityMap.get("user1"))
        ?.lastProcessedInputSeq,
    )
    expect(acks).toEqual([100, 101, 102])
  })

  it("drops queued inputs whose seq <= lastProcessedInputSeq", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    // Prime the last-processed seq to 10 by processing a higher-seq input first.
    sim.tick(
      queueMap([["user1", { ...emptyInput({ up: true }), seq: 10 }]]),
      Date.now(),
    )

    // Now enqueue a stale input (seq 9) alongside a fresh one (seq 11);
    // only the fresh one should advance the ack.
    const queue: PlayerInputPayload[] = [
      { ...emptyInput({ up: true }), seq: 9 },
      { ...emptyInput({ up: true }), seq: 11 },
    ]
    const out = sim.tick(new Map([["user1", queue]]), Date.now() + 17)
    const delta = out.playerDeltas.find((d) => d.id === sim.playerEntityMap.get("user1"))
    expect(delta?.lastProcessedInputSeq).toBe(11)
  })
})

describe("buildGameStateSyncPayload", () => {
  it("includes fireballs after a cast completes", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    sim.tick(
      queueMap([
        [
          "user1",
          emptyInput({
            abilitySlot: 0,
            abilityTargetX: 900,
            abilityTargetY: 400,
          }),
        ],
      ]),
      Date.now(),
    )
    for (let i = 0; i < 50; i++) {
      sim.tick(queueMap([["user1", emptyInput()]]), Date.now() + (i + 2) * 17)
    }
    const sync = sim.buildGameStateSyncPayload(Date.now())
    expect(sync.fireballs.length).toBeGreaterThanOrEqual(1)
    expect(sync.fireballs[0]!.ownerId).toBe("user1")
    expect(sync.players.length).toBe(1)
    expect(sync.serverTimeMs).toBeGreaterThan(0)
  })

  it("returns empty fireballs when none exist", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    sim.tick(new Map(), Date.now())
    const sync = sim.buildGameStateSyncPayload(Date.now())
    expect(sync.fireballs).toEqual([])
  })

  it("exposes per-player velocity, move state, and last processed input seq", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    // Hold W for enough ticks to clear invulnerability and register motion.
    for (let i = 0; i < 30; i++) {
      sim.tick(
        queueMap([["user1", { ...emptyInput({ up: true }), seq: 500 + i }]]),
        Date.now() + i * 17,
      )
    }

    const sync = sim.buildGameStateSyncPayload(Date.now())
    const snap = sync.players[0]!
    expect(snap.vy).toBeLessThan(0)
    expect(snap.moveState).toBe("moving")
    expect(snap.lastProcessedInputSeq).toBe(529)
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
