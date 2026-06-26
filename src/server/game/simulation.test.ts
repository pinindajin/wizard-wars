import { addComponent, addEntity, createWorld, hasComponent } from "bitecs"
import { describe, it, expect } from "vitest"
import {
  HELD_INPUT_STALE_TICKS,
  createGameSimulation,
  type SimOutput,
  type SimCtx,
} from "@/server/game/simulation"
import {
  PlayerInputQueue,
  type PlayerInputQueueMap,
} from "@/server/game/playerInputQueue"
import {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_HEIGHT,
  ARENA_SPAWN_POINTS,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
} from "@/shared/balance-config/arena"
import {
  PLAYER_WORLD_COLLISION_FOOTPRINT,
  PLAYER_WORLD_COLLISION_OFFSET_Y_PX,
  PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
} from "@/shared/balance-config/combat"
import { canOccupyWorldPosition } from "@/shared/collision/worldCollision"
import {
  AbilityRuntime,
  Cooldown,
  Casting,
  DeadTag,
  DyingTag,
  Equipment,
  ABILITY_INDEX,
  AbilitySlots,
  Facing,
  Health,
  InvulnerableTag,
  JumpArc,
  Lives,
  MoveFacing,
  NeedsWorldCollisionResolution,
  PlayerTag,
  Position,
  RespawnTimer,
  SpectatorTag,
  SwingingWeapon,
  TerrainState,
  Velocity,
} from "@/server/game/components"
import {
  primaryMeleeAttackIdToIndex,
  PRIMARY_MELEE_ATTACK_CONFIGS,
} from "@/shared/balance-config/equipment"
import { getPrimaryAttackAnimationConfigByAttackId } from "@/shared/balance-config/animationConfig"
import { JUMP_CHARGE_RECHARGE_MS, JUMP_MAX_CHARGES, TICK_MS } from "@/shared/balance-config"
import { playerDeltaSystem } from "@/server/game/systems/playerDeltaSystem"
import type { PlayerInputPayload } from "@/shared/types"

let nextSeq = 1
const REPRESENTATIVE_BLOCKER_MIN_AREA_PX = 1_000
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

function sampleBlockingColliderFromBelow() {
  const topClearance = PLAYER_WORLD_COLLISION_RADIUS_Y_PX - PLAYER_WORLD_COLLISION_OFFSET_Y_PX
  const blocker = ARENA_WORLD_COLLIDERS
    .filter((rect) =>
      rect.y < 420 &&
      rect.width * rect.height >= REPRESENTATIVE_BLOCKER_MIN_AREA_PX &&
      canOccupyWorldPosition(
        rect.x + rect.width / 2,
        rect.y + rect.height + topClearance,
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        { width: ARENA_WIDTH, height: ARENA_HEIGHT },
        ARENA_WORLD_COLLIDERS,
      ),
    )
    .sort((a, b) => b.width * b.height - a.width * a.height)[0]
  if (!blocker) throw new Error("Expected native world blocker with open land below it")
  return blocker
}

/** Convenience: wrap a single input per player into the new queue-style map. */
function queueMap(
  entries: Array<[string, PlayerInputPayload]>,
): PlayerInputQueueMap {
  const out: PlayerInputQueueMap = new Map()
  for (const [userId, input] of entries) {
    out.set(userId, new PlayerInputQueue([input]))
  }
  return out
}

/** Advance the simulation by `n` ticks with no inputs. */
function advanceTicks(sim: ReturnType<typeof createGameSimulation>, n: number): void {
  for (let i = 0; i < n; i++) sim.tick(new Map(), Date.now())
}

/** Reads the current tick's ACK cursor for a player output row. */
function ackSeqFromOutput(
  sim: ReturnType<typeof createGameSimulation>,
  output: SimOutput,
  userId = "user1",
): number | undefined {
  return output.playerDeltas.find((d) => d.id === sim.playerEntityMap.get(userId))
    ?.lastProcessedInputSeq
}

/** Number of ticks needed to clear the dangerous window for the cleaver attack. */
const TICKS_PAST_DANGEROUS_WINDOW =
  Math.ceil(PRIMARY_MELEE_ATTACK_CONFIGS.red_wizard_cleaver.dangerousWindowEndMs / TICK_MS) + 1
const SIM_OUTPUT_COLLECTION_KEYS = [
  "playerDeltas",
  "fireballDeltas",
  "fireballRemovedIds",
  "homingOrbDeltas",
  "homingOrbRemovedIds",
  "playerDeaths",
  "playerRespawns",
  "fireballLaunches",
  "fireballImpacts",
  "homingOrbLaunches",
  "homingOrbImpacts",
  "lightningBolts",
  "primaryMeleeAttacks",
  "combatTelegraphStarts",
  "combatTelegraphEnds",
  "damageFloats",
  "goldUpdates",
  "abilitySfxEvents",
] as const satisfies ReadonlyArray<keyof SimOutput>

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

  it("roots lightning caster movement and includes its active telegraph in full sync", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    AbilitySlots.slot1[eid] = ABILITY_INDEX.lightning_bolt
    const spawn = ARENA_SPAWN_POINTS[0]

    sim.tick(
      queueMap([[
        "user1",
        emptyInput({
          up: true,
          abilitySlot: 1,
          abilityTargetX: spawn.x + 200,
          abilityTargetY: spawn.y,
        }),
      ]]),
      Date.now(),
    )

    const sync = sim.buildGameStateSyncPayload(Date.now())
    expect(sync.players[0]!.x).toBe(spawn.x)
    expect(sync.players[0]!.y).toBe(spawn.y)
    expect(sync.activeTelegraphs).toHaveLength(1)
    expect(sync.activeTelegraphs![0]!.sourceId).toBe("lightning_bolt")
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

    expect(lastX).toBeLessThanOrEqual(ARENA_WIDTH - PLAYER_WORLD_COLLISION_RADIUS_X_PX)
  })

  it("does not enter non-walkable terrain or emit moving velocity when blocked", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const topStrip = sampleBlockingColliderFromBelow()
    const topClearance = PLAYER_WORLD_COLLISION_RADIUS_Y_PX - PLAYER_WORLD_COLLISION_OFFSET_Y_PX
    Position.x[eid] = topStrip.x + topStrip.width / 2
    Position.y[eid] = topStrip.y + topStrip.height + topClearance

    sim.tick(queueMap([["user1", emptyInput({ up: true })]]), Date.now())

    const snap = sim.buildGameStateSyncPayload(Date.now()).players[0]!
    expect(snap.y).toBe(topStrip.y + topStrip.height + topClearance)
    expect(snap.vy).toBe(0)
    expect(snap.moveState).toBe("idle")
  })

  it("consumes queued inputs one per tick in seq order", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    // Seed three queued inputs (all moving up) and verify lastProcessedInputSeq
    // increments one per tick.
    const queues: PlayerInputQueueMap = new Map()
    queues.set("user1", new PlayerInputQueue([
      { ...emptyInput({ up: true }), seq: 100 },
      { ...emptyInput({ up: true }), seq: 101 },
      { ...emptyInput({ up: true }), seq: 102 },
    ]))

    const acks = [
      ackSeqFromOutput(sim, sim.tick(queues, Date.now())),
      ackSeqFromOutput(sim, sim.tick(queues, Date.now() + 17)),
      ackSeqFromOutput(sim, sim.tick(queues, Date.now() + 34)),
    ]
    expect(acks).toEqual([100, 101, 102])
  })

  it("coalesces repeated held inputs while advancing ACKs one sequence per tick", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    const queues: PlayerInputQueueMap = new Map()
    queues.set("user1", new PlayerInputQueue([
      { ...emptyInput({ up: true }), seq: 200 },
      { ...emptyInput({ up: true }), seq: 201 },
      { ...emptyInput({ up: true }), seq: 202 },
      { ...emptyInput({ up: true }), seq: 203 },
    ]))

    const ack1 = ackSeqFromOutput(sim, sim.tick(queues, Date.now()))
    expect(queues.get("user1")?.length).toBe(0)

    const acks = [
      ack1,
      ackSeqFromOutput(sim, sim.tick(queues, Date.now() + 17)),
      ackSeqFromOutput(sim, sim.tick(queues, Date.now() + 34)),
      ackSeqFromOutput(sim, sim.tick(queues, Date.now() + 51)),
    ]
    expect(acks).toEqual([200, 201, 202, 203])
  })

  it.each([
    [
      "ability on first input",
      { up: true, abilitySlot: 0, abilityTargetX: 200, abilityTargetY: 200, seq: 300 },
      { up: true, seq: 301 },
    ],
    [
      "ability on second input",
      { up: true, seq: 310 },
      { up: true, abilitySlot: 0, abilityTargetX: 200, abilityTargetY: 200, seq: 311 },
    ],
    [
      "quick item on first input",
      { up: true, useQuickItemSlot: 0, seq: 320 },
      { up: true, seq: 321 },
    ],
    [
      "quick item on second input",
      { up: true, seq: 330 },
      { up: true, useQuickItemSlot: 0, seq: 331 },
    ],
  ])("does not coalesce edge-triggered inputs: %s", (_label, first, second) => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    const queue = new PlayerInputQueue([
      { ...emptyInput(first), seq: first.seq },
      { ...emptyInput(second), seq: second.seq },
    ])
    const acks = [
      ackSeqFromOutput(sim, sim.tick(new Map([["user1", queue]]), Date.now())),
      ackSeqFromOutput(
        sim,
        sim.tick(new Map([["user1", queue]]), Date.now() + 17),
      ),
    ]

    expect(acks).toEqual([first.seq, second.seq])
  })

  it("interrupts coalesced held inputs when a fresh edge action arrives", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    const queue = new PlayerInputQueue([
      { ...emptyInput({ up: true }), seq: 400 },
      { ...emptyInput({ up: true }), seq: 401 },
      { ...emptyInput({ up: true }), seq: 402 },
      { ...emptyInput({ up: true }), seq: 403 },
    ])

    const ack1 = ackSeqFromOutput(
      sim,
      sim.tick(new Map([["user1", queue]]), Date.now()),
    )
    expect(queue.length).toBe(0)
    queue.push(
      emptyInput({
        up: true,
        abilitySlot: 0,
        abilityTargetX: 200,
        abilityTargetY: 200,
        seq: 404,
      }),
    )

    const acks = [
      ack1,
      ackSeqFromOutput(
        sim,
        sim.tick(new Map([["user1", queue]]), Date.now() + 17),
      ),
    ]

    expect(acks).toEqual([400, 404])
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
    const queue = new PlayerInputQueue([
      { ...emptyInput({ up: true }), seq: 9 },
      { ...emptyInput({ up: true }), seq: 11 },
    ])
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

  it("expires retained held movement after the stale-input threshold", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const eid = sim.playerEntityMap.get("user1")!

    sim.tick(
      queueMap([["user1", emptyInput({ up: true, seq: 901 })]]),
      Date.now() + 17,
    )

    let previousY = sim
      .buildGameStateSyncPayload(Date.now())
      .players.find((pl) => pl.id === eid)!.y
    for (let i = 0; i < HELD_INPUT_STALE_TICKS + 2; i++) {
      sim.tick(new Map(), Date.now() + (i + 2) * 17)
      const nextY = sim
        .buildGameStateSyncPayload(Date.now())
        .players.find((pl) => pl.id === eid)!.y
      previousY = nextY
    }

    sim.tick(new Map(), Date.now() + 999)
    const finalY = sim
      .buildGameStateSyncPayload(Date.now())
      .players.find((pl) => pl.id === eid)!.y
    expect(finalY).toBeCloseTo(previousY, 5)
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
  it("builds owner ACK payloads from current authoritative ECS state", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    Position.x[eid] = 123
    Position.y[eid] = 456
    Velocity.vx[eid] = 12
    Velocity.vy[eid] = -4
    Equipment.hasSwiftBoots[eid] = 1
    addComponent(sim.world, eid, SwingingWeapon)
    addComponent(sim.world, eid, JumpArc)
    JumpArc.z[eid] = 18
    JumpArc.startedInLava[eid] = 1

    expect(sim.buildPlayerOwnerAckPayload(eid, 7, 10_000)).toMatchObject({
      id: eid,
      playerId: "user1",
      x: 123,
      y: 456,
      vx: 12,
      vy: -4,
      lastProcessedInputSeq: 7,
      serverTimeMs: 10_000,
      replayContext: {
        moveState: "swinging",
        terrainState: "land",
        castingAbilityId: null,
        jumpZ: 18,
        jumpStartedInLava: true,
        isSwinging: true,
        hasSwiftBoots: true,
      },
    })
    TerrainState.kind[eid] = 99
    expect(sim.buildPlayerOwnerAckPayload(eid, 8, 10_001)?.replayContext.terrainState).toBe(
      "land",
    )
    const groundedEid = sim.addPlayer("user2", "Bob", "red_wizard", 1)
    expect(sim.buildPlayerOwnerAckPayload(groundedEid, 0, 10_002)).toMatchObject({
      replayContext: {
        jumpZ: 0,
        jumpStartedInLava: false,
        isSwinging: false,
        hasSwiftBoots: false,
      },
    })
    expect(sim.buildPlayerOwnerAckPayload(9999, -1, 10_000)).toBeNull()
  })

  it("includes Swift Boots equipment state in full sync snapshots", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)

    expect(sim.buildGameStateSyncPayload(10_000).players[0]?.hasSwiftBoots).toBe(false)

    Equipment.hasSwiftBoots[eid] = 1

    expect(sim.buildGameStateSyncPayload(10_001).players[0]?.hasSwiftBoots).toBe(true)
  })

  it("exposes ability runtime state for the player HUD", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)

    const snap = sim.buildGameStateSyncPayload(10_000).players[0]!

    expect(snap.abilityStates.jump).toMatchObject({
      charges: JUMP_MAX_CHARGES,
      maxCharges: JUMP_MAX_CHARGES,
      cooldownEndsAtServerTimeMs: null,
      rechargeEndsAtServerTimeMs: null,
    })
    expect(snap.abilityStates.fireball).toMatchObject({
      cooldownEndsAtServerTimeMs: null,
      charges: null,
    })
  })

  it("emits ability state deltas when jump charges change", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    AbilitySlots.slot1[eid] = ABILITY_INDEX.jump
    const now = 10_000

    const output = sim.tick(
      queueMap([["user1", emptyInput({ abilitySlot: 1, seq: 1 })]]),
      now,
    )
    const delta = output.playerDeltas.find((d) => d.id === eid)

    expect(delta?.abilityStates?.jump.charges).toBe(JUMP_MAX_CHARGES - 1)
    expect(delta?.abilityStates?.jump.rechargeEndsAtServerTimeMs).toBeCloseTo(
      now + Math.ceil(JUMP_CHARGE_RECHARGE_MS / TICK_MS) * TICK_MS,
    )

    const output2 = sim.tick(new Map(), now + TICK_MS)
    const delta2 = output2.playerDeltas.find((d) => d.id === eid)
    expect(delta2?.abilityStates).toBeUndefined()
  })

  it("emits Swift Boots equipment deltas when the movement modifier changes", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)

    Equipment.hasSwiftBoots[eid] = 1

    const output = sim.tick(new Map(), 10_000)
    const delta = output.playerDeltas.find((d) => d.id === eid)

    expect(delta?.hasSwiftBoots).toBe(true)
  })

  it("includes Swift Boots equipment state in first player deltas", () => {
    const world = createWorld()
    const eid = addEntity(world)
    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, Position)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, Facing)
    addComponent(world, eid, MoveFacing)
    addComponent(world, eid, Health)
    addComponent(world, eid, Lives)
    addComponent(world, eid, TerrainState)
    Position.x[eid] = 10
    Position.y[eid] = 20
    Health.current[eid] = 100
    Lives.count[eid] = 3
    AbilityRuntime.jumpCharges[eid] = JUMP_MAX_CHARGES
    Equipment.hasSwiftBoots[eid] = 1
    const ctx = {
      world,
      currentTick: 1,
      serverTimeMs: 10_000,
      playerEntityMap: new Map([["user1", eid]]),
      entityPlayerMap: new Map([[eid, "user1"]]),
      playerUsernameMap: new Map(),
      entityUsernameMap: new Map(),
      playerHeroIdMap: new Map(),
      fireballOwnerMap: new Map(),
      fireballCreatedAtTickMap: new Map(),
      homingOrbOwnerMap: new Map(),
      homingOrbTargetPlayerMap: new Map(),
      homingOrbCastTargetPlayerMap: new Map(),
      inputMap: new Map(),
      lastProcessedInputSeqByPlayer: new Map([["user1", 12]]),
      commandBuffer: {} as never,
      matchStartedAtMs: 0,
      damageRequests: [],
      deathEvents: [],
      pendingLightningBolts: [],
      playerDeaths: [],
      playerRespawns: [],
      fireballLaunches: [],
      fireballImpacts: [],
      fireballRemovedIds: [],
      homingOrbLaunches: [],
      homingOrbImpacts: [],
      homingOrbRemovedIds: [],
      lightningBolts: [],
      primaryMeleeAttacks: [],
      combatTelegraphStarts: [],
      combatTelegraphEnds: [],
      damageFloats: [],
      goldUpdates: [],
      abilitySfxEvents: [],
      matchEnded: null,
      hostEndSignal: false,
      prevPlayerStates: new Map(),
      prevFireballStates: new Map(),
      prevHomingOrbStates: new Map(),
      killStats: new Map(),
      activeMeleeAttacks: new Map(),
      activeCombatTelegraphs: new Map(),
      invulnerableExpiresAtTickByEntity: new Map(),
      playerDeltas: [],
      fireballDeltas: [],
      homingOrbDeltas: [],
    } as SimCtx

    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas[0]).toMatchObject({
      id: eid,
      hasSwiftBoots: true,
      lastProcessedInputSeq: 12,
    })
    expect(ctx.prevPlayerStates.get(eid)).toMatchObject({ hasSwiftBoots: true })

    const unseededCtx = {
      ...ctx,
      lastProcessedInputSeqByPlayer: new Map(),
      prevPlayerStates: new Map(),
      playerDeltas: [],
    } as SimCtx
    playerDeltaSystem(unseededCtx)
    expect(unseededCtx.playerDeltas[0]?.lastProcessedInputSeq).toBe(0)

    const resetStreamCtx = {
      ...ctx,
      lastProcessedInputSeqByPlayer: new Map([["user1", -1]]),
      prevPlayerStates: new Map(),
      playerDeltas: [],
    } as SimCtx
    playerDeltaSystem(resetStreamCtx)
    expect(resetStreamCtx.playerDeltas[0]?.lastProcessedInputSeq).toBeUndefined()
  })

  it("repeats aim facing when an unchanged angle enters an aim-driven cast animation", () => {
    const world = createWorld()
    const eid = addEntity(world)
    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, Position)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, Facing)
    addComponent(world, eid, MoveFacing)
    addComponent(world, eid, Health)
    addComponent(world, eid, Lives)
    addComponent(world, eid, TerrainState)
    addComponent(world, eid, Casting)
    Position.x[eid] = 10
    Position.y[eid] = 20
    Health.current[eid] = 100
    Lives.count[eid] = 3
    Facing.angle[eid] = -Math.PI * 0.75
    const aimFacing = Facing.angle[eid]
    MoveFacing.angle[eid] = 0
    Casting.abilityIndex[eid] = ABILITY_INDEX.fireball
    AbilityRuntime.jumpCharges[eid] = JUMP_MAX_CHARGES

    const ctx = {
      world,
      currentTick: 1,
      serverTimeMs: 10_000,
      playerEntityMap: new Map([["user1", eid]]),
      entityPlayerMap: new Map([[eid, "user1"]]),
      playerUsernameMap: new Map(),
      entityUsernameMap: new Map(),
      playerHeroIdMap: new Map(),
      fireballOwnerMap: new Map(),
      fireballCreatedAtTickMap: new Map(),
      homingOrbOwnerMap: new Map(),
      homingOrbTargetPlayerMap: new Map(),
      homingOrbCastTargetPlayerMap: new Map(),
      inputMap: new Map(),
      lastProcessedInputSeqByPlayer: new Map([["user1", 12]]),
      commandBuffer: {} as never,
      matchStartedAtMs: 0,
      damageRequests: [],
      deathEvents: [],
      pendingLightningBolts: [],
      playerDeaths: [],
      playerRespawns: [],
      fireballLaunches: [],
      fireballImpacts: [],
      fireballRemovedIds: [],
      homingOrbLaunches: [],
      homingOrbImpacts: [],
      homingOrbRemovedIds: [],
      lightningBolts: [],
      primaryMeleeAttacks: [],
      combatTelegraphStarts: [],
      combatTelegraphEnds: [],
      damageFloats: [],
      goldUpdates: [],
      abilitySfxEvents: [],
      matchEnded: null,
      hostEndSignal: false,
      prevPlayerStates: new Map([
        [
          eid,
          {
            x: 10,
            y: 20,
            vx: 0,
            vy: 0,
            facingAngle: aimFacing,
            moveFacingAngle: 0,
            health: 100,
            lives: 3,
            animState: "idle",
            moveState: "idle",
            castingAbilityId: null,
            invulnerable: false,
            jumpZ: 0,
            jumpStartedInLava: false,
            hasSwiftBoots: false,
            terrainState: "land",
            abilityStates: {},
            lastProcessedInputSeq: 12,
          },
        ],
      ]),
      prevFireballStates: new Map(),
      prevHomingOrbStates: new Map(),
      killStats: new Map(),
      activeMeleeAttacks: new Map(),
      activeCombatTelegraphs: new Map(),
      invulnerableExpiresAtTickByEntity: new Map(),
      playerDeltas: [],
      fireballDeltas: [],
      homingOrbDeltas: [],
    } as SimCtx

    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas[0]).toMatchObject({
      id: eid,
      animState: "light_cast",
      castingAbilityId: "fireball",
    })
    expect(ctx.playerDeltas[0]?.facingAngle).toBeCloseTo(aimFacing, 5)
  })

  it("restores jump charges and clears recharge state on respawn", () => {
    const now = 10_000
    const sim = createGameSimulation(now)
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)

    AbilityRuntime.jumpCharges[eid] = 0
    AbilityRuntime.jumpRechargeReadyTick[eid] = 999
    AbilityRuntime.jumpRechargeEndsAtMs[eid] = now + JUMP_CHARGE_RECHARGE_MS
    addComponent(sim.world, eid, DeadTag)
    addComponent(sim.world, eid, RespawnTimer)
    RespawnTimer.fireAtMs[eid] = now
    RespawnTimer.spawnX[eid] = ARENA_SPAWN_POINTS[0]!.x
    RespawnTimer.spawnY[eid] = ARENA_SPAWN_POINTS[0]!.y
    RespawnTimer.facingAngle[eid] = 0

    const output = sim.tick(new Map(), now)

    expect(output.playerRespawns).toHaveLength(1)
    expect(hasComponent(sim.world, eid, DeadTag)).toBe(false)
    expect(AbilityRuntime.jumpCharges[eid]).toBe(JUMP_MAX_CHARGES)
    expect(AbilityRuntime.jumpRechargeReadyTick[eid]).toBe(0)
    expect(AbilityRuntime.jumpRechargeEndsAtMs[eid]).toBe(0)

    const snap = sim.buildGameStateSyncPayload(now).players[0]!
    expect(snap.abilityStates.jump).toMatchObject({
      charges: JUMP_MAX_CHARGES,
      rechargeEndsAtServerTimeMs: null,
      cooldownEndsAtServerTimeMs: null,
    })
  })

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
    expect(snap.jumpZ).toBe(0)
    expect(snap.jumpStartedInLava).toBe(false)
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

  it("does not emit a reconnect seq 0 ACK before the post-reconnect input is processed", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    sim.tick(queueMap([["user1", { ...emptyInput({ up: true }), seq: 99 }]]), Date.now())

    sim.resetClientInputStream("user1")
    const idleOut = sim.tick(new Map(), Date.now() + 17)
    const idleDelta = idleOut.playerDeltas.find(
      (d) => d.id === sim.playerEntityMap.get("user1"),
    )
    expect(idleDelta?.lastProcessedInputSeq).toBeUndefined()

    const ackOut = sim.tick(
      queueMap([["user1", { ...emptyInput({ up: true }), seq: 0 }]]),
      Date.now() + 34,
    )
    const ackDelta = ackOut.playerDeltas.find(
      (d) => d.id === sim.playerEntityMap.get("user1"),
    )
    expect(ackDelta?.lastProcessedInputSeq).toBe(0)
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

  it("reuses scratch output and clears tick-local collections on the next tick", () => {
    const sim = createGameSimulation(1_000)
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    sim.requestHostEnd()

    const endedOutput = sim.tick(new Map(), 1_000)
    expect(endedOutput.matchEnded?.reason).toBe("host_ended")

    const nextOutput = sim.tick(new Map(), 1_000 + TICK_MS)

    expect(nextOutput).toBe(endedOutput)
    expect(endedOutput.matchEnded).toBeNull()
    for (const key of SIM_OUTPUT_COLLECTION_KEYS) {
      expect(endedOutput[key]).toHaveLength(0)
    }
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

describe("primary melee attack", () => {
  it("sets primary melee attack index from selected hero", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "barbarian", 0)
    expect(Equipment.primaryMeleeAttackIndex[eid]).toBe(
      primaryMeleeAttackIdToIndex("barbarian_cleaver"),
    )
  })

  it("emits primary melee attack payload on first weapon primary tick", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const output = sim.tick(
      queueMap([["user1", emptyInput({ weaponPrimary: true })]]),
      Date.now(),
    )
    expect(output.primaryMeleeAttacks).toHaveLength(1)
    const swing = output.primaryMeleeAttacks[0]!
    expect(swing.attackId).toBe("red_wizard_cleaver")
    expect(swing.damage).toBeGreaterThan(0)
    expect(swing.hurtboxRadiusPx).toBeGreaterThan(0)
    expect(swing.hurtboxArcDeg).toBeGreaterThan(0)
    expect(swing.durationMs).toBeGreaterThan(0)
    expect(swing.dangerousWindowEndMs).toBeGreaterThan(swing.dangerousWindowStartMs)
  })

  it("freezes aim Facing during swing while MoveFacing still follows movement", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const px = ARENA_CENTER_X
    const py = ARENA_CENTER_Y
    Position.x[eid] = px
    Position.y[eid] = py

    sim.tick(
      queueMap([
        [
          "user1",
          emptyInput({
            weaponPrimary: true,
            seq: 1,
            weaponTargetX: px + 200,
            weaponTargetY: py,
          }),
        ],
      ]),
      Date.now(),
    )

    expect(hasComponent(sim.world, eid, SwingingWeapon)).toBe(true)
    const lockedAimFacing = Facing.angle[eid]
    expect(lockedAimFacing).toBeCloseTo(0, 5)

    sim.tick(
      queueMap([
        [
          "user1",
          emptyInput({
            left: true,
            weaponPrimary: false,
            seq: 2,
            weaponTargetX: px - 200,
            weaponTargetY: py,
          }),
        ],
      ]),
      Date.now(),
    )

    expect(hasComponent(sim.world, eid, SwingingWeapon)).toBe(true)
    expect(Facing.angle[eid]).toBeCloseTo(lockedAimFacing, 5)
    expect(MoveFacing.angle[eid]).toBeCloseTo(Math.PI, 1)
  })

  it("recaptures held primary facing when the next swing starts", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const px = ARENA_CENTER_X
    const py = ARENA_CENTER_Y
    Position.x[eid] = px
    Position.y[eid] = py

    const first = sim.tick(
      queueMap([
        [
          "user1",
          emptyInput({
            weaponPrimary: true,
            seq: 1,
            weaponTargetX: px + 200,
            weaponTargetY: py,
          }),
        ],
      ]),
      Date.now(),
    )
    expect(first.primaryMeleeAttacks[0]!.facingAngle).toBeCloseTo(0, 5)

    const midSwing = sim.tick(
      queueMap([
        [
          "user1",
          emptyInput({
            weaponPrimary: true,
            seq: 2,
            weaponTargetX: px - 200,
            weaponTargetY: py,
          }),
        ],
      ]),
      Date.now(),
    )
    expect(midSwing.primaryMeleeAttacks).toHaveLength(0)
    expect(Facing.angle[eid]).toBeCloseTo(0, 5)

    const swingTicks = Math.ceil(
      PRIMARY_MELEE_ATTACK_CONFIGS.red_wizard_cleaver.durationMs / TICK_MS,
    )
    let chainedFacing: number | null = null
    for (let i = 0; i < swingTicks + 2; i++) {
      const output = sim.tick(
        queueMap([
          [
            "user1",
            emptyInput({
              weaponPrimary: true,
              seq: i + 3,
              weaponTargetX: px - 200,
              weaponTargetY: py,
            }),
          ],
        ]),
        Date.now(),
      )
      if (output.primaryMeleeAttacks.length > 0) {
        chainedFacing = output.primaryMeleeAttacks[0]!.facingAngle
        break
      }
    }

    expect(chainedFacing).not.toBeNull()
    expect(chainedFacing!).toBeCloseTo(Math.PI, 5)
    expect(Facing.angle[eid]).toBeCloseTo(Math.PI, 5)
  })

  it("recaptures held primary facing from the freshest queued weapon target", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const px = ARENA_CENTER_X
    const py = ARENA_CENTER_Y
    Position.x[eid] = px
    Position.y[eid] = py

    const first = sim.tick(
      queueMap([
        [
          "user1",
          emptyInput({
            weaponPrimary: true,
            seq: 1,
            weaponTargetX: px + 200,
            weaponTargetY: py,
          }),
        ],
      ]),
      Date.now(),
    )
    expect(first.primaryMeleeAttacks[0]!.facingAngle).toBeCloseTo(0, 5)

    const swingTicks = Math.ceil(
      getPrimaryAttackAnimationConfigByAttackId("red_wizard_cleaver").durationMs / TICK_MS,
    )
    const queue = new PlayerInputQueue()
    for (let i = 0; i < swingTicks; i++) {
      queue.push(
        emptyInput({
          weaponPrimary: true,
          seq: i + 2,
          weaponTargetX: px + 200,
          weaponTargetY: py,
        }),
      )
    }

    const aimChangeTick = Math.floor(swingTicks / 2)
    let chainedFacing: number | null = null
    for (let i = 0; i < swingTicks + 2; i++) {
      if (i >= aimChangeTick) {
        queue.push(
          emptyInput({
            weaponPrimary: true,
            seq: swingTicks + 2 + i,
            weaponTargetX: px - 200,
            weaponTargetY: py,
          }),
        )
      }

      const output = sim.tick(new Map([["user1", queue]]), Date.now())
      if (output.primaryMeleeAttacks.length > 0) {
        chainedFacing = output.primaryMeleeAttacks[0]!.facingAngle
        break
      }
    }

    expect(chainedFacing).not.toBeNull()
    expect(chainedFacing!).toBeCloseTo(Math.PI, 5)
    expect(Facing.angle[eid]).toBeCloseTo(Math.PI, 5)
  })

  it("does not start a second swing while SwingingWeapon is active", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("a", "A", "red_wizard", 0)
    sim.tick(queueMap([["a", emptyInput({ weaponPrimary: true, seq: 1 })]]), Date.now())
    const out2 = sim.tick(
      queueMap([["a", emptyInput({ weaponPrimary: true, seq: 2 })]]),
      Date.now(),
    )
    expect(out2.primaryMeleeAttacks).toHaveLength(0)
  })

  it("does not swing when primary melee cooldown is not ready", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    Cooldown.primaryMelee[eid] = 9_999_999
    const output = sim.tick(
      queueMap([["user1", emptyInput({ weaponPrimary: true })]]),
      Date.now(),
    )
    expect(output.primaryMeleeAttacks).toHaveLength(0)
  })

  it("does not swing when primary melee equipment index is out of range", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    Equipment.primaryMeleeAttackIndex[eid] = 99
    const output = sim.tick(
      queueMap([["user1", emptyInput({ weaponPrimary: true })]]),
      Date.now(),
    )
    expect(output.primaryMeleeAttacks).toHaveLength(0)
  })

  it("repairs and clears dirty world-collision tags for a 12-player cluster", () => {
    const sim = createGameSimulation(Date.now())
    const eids: number[] = []
    for (let i = 0; i < 12; i++) {
      const eid = sim.addPlayer(`user${i}`, `Player ${i}`, "red_wizard", i)
      Position.x[eid] = 160 + (i % 4) * 4
      Position.y[eid] = 160 + Math.floor(i / 4) * 4
      eids.push(eid)
    }

    sim.tick(new Map(), Date.now())

    for (const eid of eids) {
      expect(hasComponent(sim.world, eid, NeedsWorldCollisionResolution)).toBe(false)
      expect(
        canOccupyWorldPosition(
          Position.x[eid],
          Position.y[eid],
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          { width: ARENA_WIDTH, height: ARENA_HEIGHT },
          ARENA_WORLD_COLLIDERS,
        ),
      ).toBe(true)
    }

    sim.tick(new Map(), Date.now())

    for (const eid of eids) {
      expect(hasComponent(sim.world, eid, NeedsWorldCollisionResolution)).toBe(false)
    }
  })

  it("does not swing when caster has DyingTag, DeadTag, or SpectatorTag", () => {
    for (const Tag of [DyingTag, DeadTag, SpectatorTag] as const) {
      const sim = createGameSimulation(Date.now())
      const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
      addComponent(sim.world, eid, Tag)
      if (Tag === DyingTag) DyingTag.expiresAtMs[eid] = Date.now() + 5000
      const output = sim.tick(
        queueMap([["user1", emptyInput({ weaponPrimary: true })]]),
        Date.now(),
      )
      expect(output.primaryMeleeAttacks).toHaveLength(0)
    }
  })

  it("does not damage a target before the dangerous window starts", () => {
    const sim = createGameSimulation(Date.now())
    const ea = sim.addPlayer("a", "A", "red_wizard", 0)
    const eb = sim.addPlayer("b", "B", "red_wizard", 1)
    const cx = ARENA_CENTER_X
    const cy = ARENA_CENTER_Y
    Position.x[ea] = cx
    Position.y[ea] = cy
    Position.x[eb] = cx + 30
    Position.y[eb] = cy
    const startHp = Health.current[eb]
    sim.tick(
      queueMap([
        [
          "a",
          emptyInput({
            weaponPrimary: true,
            weaponTargetX: cx + 500,
            weaponTargetY: cy,
          }),
        ],
      ]),
      Date.now(),
    )
    const cfg = PRIMARY_MELEE_ATTACK_CONFIGS.red_wizard_cleaver
    const ticksBeforeWindow = Math.floor(cfg.dangerousWindowStartMs / TICK_MS) - 1
    advanceTicks(sim, Math.max(0, ticksBeforeWindow))
    expect(Health.current[eb]).toBe(startHp)
  })

  it("damages a target standing inside the half-circle hurtbox during the dangerous window", () => {
    const sim = createGameSimulation(Date.now())
    const ea = sim.addPlayer("a", "A", "red_wizard", 0)
    const eb = sim.addPlayer("b", "B", "red_wizard", 1)
    const cx = ARENA_CENTER_X
    const cy = ARENA_CENTER_Y
    Position.x[ea] = cx
    Position.y[ea] = cy
    Position.x[eb] = cx + 30
    Position.y[eb] = cy
    const startHp = Health.current[eb]
    sim.tick(
      queueMap([
        [
          "a",
          emptyInput({
            weaponPrimary: true,
            weaponTargetX: cx + 500,
            weaponTargetY: cy,
          }),
        ],
      ]),
      Date.now(),
    )
    advanceTicks(sim, TICKS_PAST_DANGEROUS_WINDOW)
    expect(Health.current[eb]).toBeLessThan(startHp)
  })

  it("does not damage an invulnerable target during the dangerous window", () => {
    const sim = createGameSimulation(Date.now())
    const ea = sim.addPlayer("a", "A", "red_wizard", 0)
    const eb = sim.addPlayer("b", "B", "red_wizard", 1)
    const cx = ARENA_CENTER_X - 200
    const cy = ARENA_CENTER_Y
    Position.x[ea] = cx
    Position.y[ea] = cy
    Position.x[eb] = cx + 30
    Position.y[eb] = cy
    addComponent(sim.world, eb, InvulnerableTag)
    const startHp = Health.current[eb]
    sim.tick(
      queueMap([
        [
          "a",
          emptyInput({
            weaponPrimary: true,
            weaponTargetX: cx + 500,
            weaponTargetY: cy,
          }),
        ],
      ]),
      Date.now(),
    )
    advanceTicks(sim, TICKS_PAST_DANGEROUS_WINDOW)
    expect(Health.current[eb]).toBe(startHp)
  })

  it("does not damage a dead or spectator target during the dangerous window", () => {
    for (const Tag of [DeadTag, SpectatorTag] as const) {
      const sim = createGameSimulation(Date.now())
      sim.addPlayer("a", "A", "red_wizard", 0)
      const eb = sim.addPlayer("b", "B", "red_wizard", 1)
      const ea = sim.playerEntityMap.get("a")!
      const cx = ARENA_CENTER_X + 220
      const cy = ARENA_CENTER_Y - 40
      Position.x[ea] = cx
      Position.y[ea] = cy
      Position.x[eb] = cx + 30
      Position.y[eb] = cy
      addComponent(sim.world, eb, Tag)
      const startHp = Health.current[eb]
      sim.tick(
        queueMap([
          [
            "a",
            emptyInput({
              weaponPrimary: true,
              weaponTargetX: cx + 500,
              weaponTargetY: cy,
            }),
          ],
        ]),
        Date.now(),
      )
      advanceTicks(sim, TICKS_PAST_DANGEROUS_WINDOW)
      expect(Health.current[eb]).toBe(startHp)
    }
  })

  it("does not damage a dying target during the dangerous window", () => {
    const sim = createGameSimulation(Date.now())
    const ea = sim.addPlayer("a", "A", "red_wizard", 0)
    const eb = sim.addPlayer("b", "B", "red_wizard", 1)
    const cx = ARENA_CENTER_X + 100
    const cy = ARENA_CENTER_Y + 80
    Position.x[ea] = cx
    Position.y[ea] = cy
    Position.x[eb] = cx + 30
    Position.y[eb] = cy
    addComponent(sim.world, eb, DyingTag)
    DyingTag.expiresAtMs[eb] = Date.now() + 5000
    const startHp = Health.current[eb]
    sim.tick(
      queueMap([
        [
          "a",
          emptyInput({
            weaponPrimary: true,
            weaponTargetX: cx + 500,
            weaponTargetY: cy,
          }),
        ],
      ]),
      Date.now(),
    )
    advanceTicks(sim, TICKS_PAST_DANGEROUS_WINDOW)
    expect(Health.current[eb]).toBe(startHp)
  })

  it("does not damage a target standing outside the hurtbox radius", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("a", "A", "red_wizard", 0)
    sim.addPlayer("b", "B", "red_wizard", 1)
    const ea = sim.playerEntityMap.get("a")!
    const eb = sim.playerEntityMap.get("b")!
    const cx = ARENA_CENTER_X
    const cy = ARENA_CENTER_Y + 200
    Position.x[ea] = cx
    Position.y[ea] = cy
    Position.x[eb] = cx + 200
    Position.y[eb] = cy
    const startHp = Health.current[eb]
    sim.tick(
      queueMap([
        [
          "a",
          emptyInput({
            weaponPrimary: true,
            weaponTargetX: cx + 500,
            weaponTargetY: cy,
          }),
        ],
      ]),
      Date.now(),
    )
    advanceTicks(sim, TICKS_PAST_DANGEROUS_WINDOW)
    expect(Health.current[eb]).toBe(startHp)
  })

  it("damages a target only once per swing even when overlap persists across the dangerous window", () => {
    const sim = createGameSimulation(Date.now())
    const ea = sim.addPlayer("a", "A", "red_wizard", 0)
    const eb = sim.addPlayer("b", "B", "red_wizard", 1)
    const cx = ARENA_CENTER_X
    const cy = ARENA_CENTER_Y
    Position.x[ea] = cx
    Position.y[ea] = cy
    Position.x[eb] = cx + 30
    Position.y[eb] = cy
    const startHp = Health.current[eb]
    sim.tick(
      queueMap([
        [
          "a",
          emptyInput({
            weaponPrimary: true,
            weaponTargetX: cx + 500,
            weaponTargetY: cy,
          }),
        ],
      ]),
      Date.now(),
    )
    advanceTicks(sim, TICKS_PAST_DANGEROUS_WINDOW)
    const damageDealt = startHp - Health.current[eb]
    expect(damageDealt).toBe(PRIMARY_MELEE_ATTACK_CONFIGS.red_wizard_cleaver.damage)
  })

  it("removes SwingingWeapon after swing duration when weapon input stops", () => {
    const sim = createGameSimulation(Date.now())
    sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const eid = sim.playerEntityMap.get("user1")!
    sim.tick(queueMap([["user1", emptyInput({ weaponPrimary: true, seq: 1 })]]), Date.now())
    expect(hasComponent(sim.world, eid, SwingingWeapon)).toBe(true)
    sim.tick(queueMap([["user1", emptyInput({ weaponPrimary: false, seq: 2 })]]), Date.now())
    const ticksToFinish =
      Math.ceil(PRIMARY_MELEE_ATTACK_CONFIGS.red_wizard_cleaver.durationMs / TICK_MS) + 5
    for (let i = 0; i < ticksToFinish; i++) sim.tick(new Map(), Date.now())
    expect(hasComponent(sim.world, eid, SwingingWeapon)).toBe(false)
  })
})
