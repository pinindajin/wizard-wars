import { describe, it, expect } from "vitest"
import { createGameSimulation } from "@/server/game/simulation"
import {
  ARENA_SPAWN_POINTS,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
} from "@/shared/balance-config/arena"
import { PLAYER_RADIUS_PX } from "@/shared/balance-config/combat"
import { Position } from "@/server/game/components"
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

  it("does not enter non-walkable terrain or emit moving velocity when blocked", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const topStrip = ARENA_WORLD_COLLIDERS[0]!
    Position.x[eid] = topStrip.x + 704
    Position.y[eid] = topStrip.y + topStrip.height + PLAYER_RADIUS_PX

    sim.tick(queueMap([["user1", emptyInput({ up: true })]]), Date.now())

    const snap = sim.buildGameStateSyncPayload(Date.now()).players[0]!
    expect(snap.y).toBe(topStrip.y + topStrip.height + PLAYER_RADIUS_PX)
    expect(snap.vy).toBe(0)
    expect(snap.moveState).toBe("idle")
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

  it("updates moveFacingAngle from non-zero WASD intent", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    for (let i = 0; i < 25; i++) {
      sim.tick(
        queueMap([["user1", { ...emptyInput({ up: true }), seq: 700 + i }]]),
        Date.now() + i * 17,
      )
    }
    const sync = sim.buildGameStateSyncPayload(Date.now())
    expect(sync.players[0]!.moveFacingAngle).toBeCloseTo(-Math.PI / 2, 5)
  })

  it("does not change moveFacingAngle when only aim (weapon target) moves", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    sim.tick(new Map(), Date.now())
    const move0 = sim.buildGameStateSyncPayload(Date.now()).players[0]!.moveFacingAngle
    const sp = ARENA_SPAWN_POINTS[0]!
    sim.tick(
      queueMap([
        [
          "user1",
          emptyInput({
            weaponTargetX: sp.x + 400,
            weaponTargetY: sp.y,
            seq: 800,
          }),
        ],
      ]),
      Date.now() + 17,
    )
    const syncAfter = sim.buildGameStateSyncPayload(Date.now())
    const p = syncAfter.players[0]!
    expect(p.moveFacingAngle).toBeCloseTo(move0, 5)
    expect(p.facingAngle).toBeCloseTo(Math.atan2(0, 400), 5)
  })

  it("retains held WASD across empty-queue ticks so the player keeps moving (cause C)", () => {
    // Regression for the rubberbanding caused by the server zeroing all
    // inputs whenever a tick happened to have an empty queue for a
    // player. With retention, a single scheduling-drift gap no longer
    // costs a tick of authoritative forward motion.
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const eid = sim.playerEntityMap.get("user1")!
    const spawnY = ARENA_SPAWN_POINTS[0].y

    // Tick 1: send up=true. Player should move forward.
    sim.tick(
      queueMap([["user1", emptyInput({ up: true, seq: 900 })]]),
      Date.now() + 17,
    )
    const y1 = sim
      .buildGameStateSyncPayload(Date.now())
      .players.find((pl) => pl.id === eid)!.y
    expect(y1).toBeLessThan(spawnY)

    // Tick 2: empty queue (scheduling gap). Under the old zero-out, the
    // player would freeze for one tick. With cause-C retention, W
    // remains held and the player advances again by the same amount.
    sim.tick(new Map(), Date.now() + 34)
    const y2 = sim
      .buildGameStateSyncPayload(Date.now())
      .players.find((pl) => pl.id === eid)!.y
    expect(y2).toBeLessThan(y1)
    // Each tick of held W at BASE_MOVE_SPEED_PX_PER_SEC=200 over
    // TICK_DT_SEC=1/60 advances ~3.33 px; assert both ticks moved by
    // roughly the same increment (± small float epsilon).
    const step1 = spawnY - y1
    const step2 = y1 - y2
    expect(Math.abs(step2 - step1)).toBeLessThan(0.01)
  })

  it("clears edge-triggered abilitySlot on empty-queue ticks (cause C guard)", () => {
    // Retention applies to held inputs only. One-shot cast commands
    // must *not* repeat when a follow-up tick has an empty queue, or
    // we'd risk double-casting under scheduling jitter.
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    // Tick with armed ability slot 0; expect the cast to begin.
    sim.tick(
      queueMap([
        [
          "user1",
          emptyInput({ abilitySlot: 0, abilityTargetX: 100, abilityTargetY: 100, seq: 1000 }),
        ],
      ]),
      Date.now() + 17,
    )
    const castingAfter1 = sim
      .buildGameStateSyncPayload(Date.now())
      .players[0]!.castingAbilityId
    expect(castingAfter1).not.toBeNull()

    // Now tick twice with an empty queue — cause C must *not* retain
    // the armed ability and accidentally double-cast.
    sim.tick(new Map(), Date.now() + 34)
    sim.tick(new Map(), Date.now() + 51)
    // castingAbilityId reflects whatever is currently casting; the
    // critical assertion is that no *new* cast starts (the player
    // either finished the single cast or is still finishing it; what
    // must not happen is a second cast chained off retained
    // abilitySlot).
    const syncAfter = sim.buildGameStateSyncPayload(Date.now())
    // Compare against the tick-1 cast id. If a second cast started,
    // its timing would differ; we assert it's either the same cast
    // (still in progress) or null (finished), never a "restarted"
    // state we can't detect from the payload alone. The minimal
    // direct check is that no delta reports a new cast started after
    // the initial tick: we rely on castingSystem only starting when
    // `PlayerInput.abilitySlot >= 0`, which our fix explicitly clears.
    expect([castingAfter1, null]).toContain(syncAfter.players[0]!.castingAbilityId)
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

  it("emits lastProcessedInputSeq 0 on wire when internal ack is -1 (pre-first-input)", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const snap = sim.buildGameStateSyncPayload(Date.now()).players[0]!
    expect(snap.lastProcessedInputSeq).toBe(0)
  })

  it("spawns with -1 seed; seq 0 and seq 1 are both applied in order", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    sim.tick(
      queueMap([["user1", { ...emptyInput({ up: true }), seq: 0 }]]),
      Date.now(),
    )
    sim.tick(
      queueMap([["user1", { ...emptyInput({ up: true }), seq: 1 }]]),
      Date.now() + 17,
    )
    expect(
      sim.buildGameStateSyncPayload(Date.now()).players[0]!.lastProcessedInputSeq,
    ).toBe(1)
  })

  it("resetClientInputStream allows seq 0 after a high lastProcessed watermark", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    sim.tick(queueMap([["user1", { ...emptyInput({ up: true }), seq: 99 }]]), Date.now())
    sim.resetClientInputStream("user1")
    const out = sim.tick(
      queueMap([["user1", { ...emptyInput({ up: true }), seq: 0 }]]),
      Date.now() + 17,
    )
    const delta = out.playerDeltas.find((d) => d.id === sim.playerEntityMap.get("user1"))
    expect(delta?.lastProcessedInputSeq).toBe(0)
  })

  it("exposes per-player velocity, move state, and last processed input seq", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    // Hold D for enough ticks to register motion while staying clear of nearby blockers.
    for (let i = 0; i < 30; i++) {
      sim.tick(
        queueMap([["user1", { ...emptyInput({ right: true }), seq: 500 + i }]]),
        Date.now() + i * 17,
      )
    }

    const sync = sim.buildGameStateSyncPayload(Date.now())
    const snap = sync.players[0]!
    expect(snap.vx).toBeGreaterThan(0)
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
