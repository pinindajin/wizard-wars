import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("phaser", () => {
  /**
   * Converts a packed RGB number into a channel object for test-only Phaser mocks.
   *
   * @param value - Packed RGB value.
   * @returns Split RGB channels.
   */
  function valueToColor(value: number): { r: number; g: number; b: number } {
    return {
      r: (value >> 16) & 0xff,
      g: (value >> 8) & 0xff,
      b: value & 0xff,
    }
  }

  /**
   * Returns a stable packed RGB value from channel inputs for test-only Phaser mocks.
   *
   * @param r - Red channel.
   * @param g - Green channel.
   * @param b - Blue channel.
   * @returns Packed RGB value.
   */
  function getColor(r: number, g: number, b: number): number {
    return (r << 16) | (g << 8) | b
  }

  return {
    default: {
      Scenes: {
        SHUTDOWN: 8,
        DESTROYED: 9,
      },
      Display: {
        Color: {
          ValueToColor: valueToColor,
          GetColor: getColor,
          Interpolate: {
            ColorWithColor: (_from: { r: number; g: number; b: number }, to: { r: number; g: number; b: number }) => to,
          },
        },
      },
    },
  }
})

import Phaser from "phaser"

import {
  computeHeroHudYOffsets,
  FOOT_MARKER_CENTER_Y_OFFSET_FROM_FOOT,
  HUD_CLEARANCE_ABOVE_SPRITE_TOP_PX,
  LADY_WIZARD_FRAME_HEIGHT_PX,
  NAME_TO_HP_BAR_GAP_PX,
  PlayerRenderSystem,
} from "./PlayerRenderSystem"
import type { LocalReplayContext } from "./ReconciliationSystem"
import { ClientPosition, ClientPlayerState, ClientRenderPos } from "../components"
import { clientEntities, removeEntity } from "../world"
import type {
  PlayerInputPayload,
  PlayerSnapshot,
  PrimaryMeleeAttackPayload,
} from "@/shared/types"
import { getHeroAnimKey, getDirectionFromAngle } from "../../animation/LadyWizardAnimDefs"
import { WW_ABILITY_SLOTS_REGISTRY_KEY } from "../../constants"
import { HERO_CONFIGS } from "@/shared/balance-config/heroes"
import {
  ARENA_HEIGHT,
  ARENA_LAVA_COLLIDERS,
  ARENA_PROP_COLLIDERS,
  ARENA_SPAWN_POINTS,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
  BASE_MOVE_SPEED_PX_PER_SEC,
  JUMP_AIRBORNE_COLLIDER_EPSILON_PX,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
  SWIFT_BOOTS_SPEED_BONUS,
  TICK_DT_SEC,
} from "@/shared/balance-config"
import { terrainStateAtPosition } from "@/shared/collision/terrainHazards"
import { canOccupyWorldPosition } from "@/shared/collision/worldCollision"
import { REPLAY_SMOOTHING_MS } from "@/shared/balance-config/rendering"

const OPEN_TEST_POINT = ARENA_SPAWN_POINTS[0]!
const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }
const REPRESENTATIVE_BLOCKER_MIN_AREA_PX = 1_000

function canPlayerOccupy(x: number, y: number): boolean {
  return canOccupyWorldPosition(
    x,
    y,
    PLAYER_WORLD_COLLISION_FOOTPRINT,
    ARENA_BOUNDS,
    ARENA_WORLD_COLLIDERS,
  )
}

function sampleDiagonalSlideCase() {
  const blocker = ARENA_WORLD_COLLIDERS
    .filter((rect) =>
      rect.y < 420 &&
      rect.width * rect.height >= REPRESENTATIVE_BLOCKER_MIN_AREA_PX &&
      canPlayerOccupy(
        rect.x + rect.width / 2,
        rect.y + rect.height + PLAYER_WORLD_COLLISION_FOOTPRINT.radiusY -
          PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY + 3,
      ),
    )
    .sort((a, b) => b.width * b.height - a.width * a.height)[0]
  if (!blocker) throw new Error("Expected representative native upper blocker")
  return {
    blocker,
    start: {
      x: blocker.x + blocker.width / 2,
      y:
        blocker.y + blocker.height + PLAYER_WORLD_COLLISION_FOOTPRINT.radiusY -
        PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY + 3,
    },
  }
}

function sampleBlockedSmoothingCase() {
  const blocker = ARENA_PROP_COLLIDERS.find((rect) => {
    const y = rect.y + rect.height / 2 - PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY
    return (
      canPlayerOccupy(rect.x - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX - 4, y) &&
      canPlayerOccupy(rect.x + rect.width + PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX + 4, y)
    )
  })
  if (!blocker) throw new Error("Expected native prop blocker with legal smoothing endpoints")
  const y = blocker.y + blocker.height / 2 - PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY
  return {
    blocker,
    start: {
      x: blocker.x - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX - 4,
      y,
    },
    target: {
      x: blocker.x + blocker.width + PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX + 4,
      y,
    },
  }
}

function sampleRightwardPredictionStart() {
  const start = ARENA_SPAWN_POINTS.find((point) => canPlayerOccupy(point.x + 50, point.y))
  if (!start) throw new Error("Expected a spawn point with rightward prediction clearance")
  return start
}

function input(overrides: Partial<PlayerInputPayload> & { seq: number }): PlayerInputPayload {
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
    ...overrides,
  }
}

function sampleLavaRect() {
  for (const rect of [...ARENA_LAVA_COLLIDERS].sort((a, b) => a.y - b.y || a.x - b.x)) {
    for (let y = Math.max(100, rect.y); y < Math.min(rect.y + rect.height, ARENA_HEIGHT - 20); y++) {
      for (let x = rect.x + rect.width - 1; x >= rect.x; x--) {
        if (x < 30 || x >= ARENA_WIDTH - 30) continue
        if (terrainStateAtPosition(x, y) === "lava" && terrainStateAtPosition(x + 1, y) !== "lava") {
          return { rect, point: { x, y } }
        }
      }
    }
  }
  throw new Error("Expected native lava with a right-hand non-lava edge")
}

type TestRenderEntry = {
  smoothRemainingMs: number
  smoothTargetX: number
  smoothTargetY: number
}

type LocalCastResolver = {
  _localCastAbilityIdForInput: (
    state: PlayerSnapshot,
    input: PlayerInputPayload | null,
  ) => string | null
  _abilityIdForSlot: (slotIndex: number) => string | null
  _clientCastMoveMultiplier: (
    state: PlayerSnapshot,
    localCastAbilityId?: string | null,
  ) => number
  _canPredictMovement: (
    state: PlayerSnapshot,
    moveIntent: {
      up: boolean
      down: boolean
      left: boolean
      right: boolean
    },
    castMoveMult: number,
    localCastAbilityId?: string | null,
  ) => boolean
  _localReplayContextForInput: (
    state: PlayerSnapshot,
    input: PlayerInputPayload,
    baseCtx: LocalReplayContext,
  ) => LocalReplayContext
}

function abilityStates() {
  return {
    fireball: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: null,
      maxCharges: null,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
    lightning_bolt: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: null,
      maxCharges: null,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
    homing_orb: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: 4,
      maxCharges: 4,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
    jump: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: 4,
      maxCharges: 4,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
  }
}

function replayCtx(overrides: Partial<LocalReplayContext> = {}): LocalReplayContext {
  return {
    isSwinging: false,
    hasSwiftBoots: false,
    castingAbilityId: null,
    jumpZ: 0,
    jumpStartedInLava: false,
    moveState: "idle",
    terrainState: "land",
    ...overrides,
  }
}

function snap(over: Partial<PlayerSnapshot> & Pick<PlayerSnapshot, "id" | "playerId">): PlayerSnapshot {
  return {
    id: over.id,
    playerId: over.playerId,
    username: over.username ?? "u",
    x: over.x ?? 0,
    y: over.y ?? 0,
    vx: over.vx ?? 0,
    vy: over.vy ?? 0,
    facingAngle: over.facingAngle ?? 0,
    moveFacingAngle: over.moveFacingAngle ?? 0,
    health: over.health ?? 10,
    maxHealth: over.maxHealth ?? 10,
    lives: over.lives ?? 3,
    heroId: over.heroId ?? "yen",
    animState: over.animState ?? "idle",
    moveState: over.moveState ?? "idle",
    terrainState: over.terrainState ?? "land",
    castingAbilityId: over.castingAbilityId ?? null,
    invulnerable: over.invulnerable ?? false,
    jumpZ: over.jumpZ ?? 0,
    jumpStartedInLava: over.jumpStartedInLava ?? false,
    hasSwiftBoots: over.hasSwiftBoots ?? false,
    abilityStates: over.abilityStates ?? abilityStates(),
    lastProcessedInputSeq: over.lastProcessedInputSeq ?? 0,
  }
}

function sync(players: PlayerSnapshot[]): {
  players: PlayerSnapshot[]
  fireballs: never[]
  seq: number
  serverTimeMs: number
} {
  return { players, fireballs: [], seq: 0, serverTimeMs: Date.now() }
}

function mockSceneAndGroup() {
  const destroyed: string[] = []
  const spriteDestroy = vi.fn(() => destroyed.push("sprite"))
  const textDestroy = vi.fn(() => destroyed.push("text"))
  const gfxDestroy = vi.fn(() => destroyed.push("gfx"))
  const ellipseDestroy = vi.fn(() => destroyed.push("ellipse"))
  const registryValues = new Map<string, unknown>()

  const textChain = {
    destroy: textDestroy,
    setOrigin: vi.fn(function textOrigin() {
      return textChain
    }),
    setDepth: vi.fn(function textDepth() {
      return textChain
    }),
    setVisible: vi.fn(),
    setPosition: vi.fn(),
  }

  const scene = {
    game: {
      registry: {
        get: vi.fn((key: string) => registryValues.get(key)),
        set: vi.fn((key: string, value: unknown) => {
          registryValues.set(key, value)
        }),
      },
    },
    add: {
      sprite: vi.fn((x: number, y: number) => {
        const sprite = {
          x,
          y,
          active: true,
          scene: {},
          anims: { animationManager: {} },
          destroy: spriteDestroy,
          setOrigin: vi.fn(),
          setTint: vi.fn(),
          clearTint: vi.fn(),
          setDepth: vi.fn(),
          setCrop: vi.fn(),
          play: vi.fn(),
          setPosition: vi.fn((nextX: number, nextY: number) => {
            sprite.x = nextX
            sprite.y = nextY
            return sprite
          }),
          setAlpha: vi.fn(),
          setVisible: vi.fn(),
        }
        return sprite
      }),
      ellipse: vi.fn((...args: number[]) => {
        const x = args[0] ?? 0
        const y = args[1] ?? 0
        const ellipse = {
          x,
          y,
          destroy: ellipseDestroy,
          setPosition: vi.fn((nextX: number, nextY: number) => {
            ellipse.x = nextX
            ellipse.y = nextY
            return ellipse
          }),
          setDepth: vi.fn(),
          setVisible: vi.fn(),
        }
        return ellipse
      }),
      text: vi.fn(() => textChain),
      graphics: vi.fn(() => ({
        destroy: gfxDestroy,
        setData: vi.fn(),
        setDepth: vi.fn(),
        setVisible: vi.fn(),
        clear: vi.fn(),
        fillStyle: vi.fn(),
        fillRect: vi.fn(),
      })),
    },
  }

  const group = { add: vi.fn() }

  return {
    scene,
    group,
    destroyed,
    registryValues,
    spriteDestroy,
    textDestroy,
    gfxDestroy,
    ellipseDestroy,
  }
}

describe("PlayerRenderSystem.applyFullSync", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"))
    for (const id of [...clientEntities]) {
      removeEntity(id)
      delete ClientPosition[id]
      delete ClientRenderPos[id]
      delete ClientPlayerState[id]
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("destroys Phaser objects when a player leaves the snapshot", () => {
    const { scene, group, destroyed } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    const a = snap({ id: 1, playerId: "p1" })
    const b = snap({ id: 2, playerId: "p2" })
    sys.applyFullSync(sync([a, b]))
    sys.applyFullSync(sync([a]))

    expect(destroyed).toContain("sprite")
    expect(destroyed).toContain("ellipse")
    expect(destroyed).toContain("text")
    expect(destroyed).toContain("gfx")
    expect(clientEntities.has(2)).toBe(false)
    expect(ClientPlayerState[2]).toBeUndefined()
  })

  it("spawns a hero-specific sprite, foot ellipse 32×16 in hero color, and never hero-tints the body", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    sys.applyFullSync(sync([snap({ id: 1, playerId: "p1", heroId: "triss", x: 10, y: 20 })]))

    const add = scene.add as {
      sprite: ReturnType<typeof vi.fn>
      ellipse: ReturnType<typeof vi.fn>
    }

    const footY = 20 + FOOT_MARKER_CENTER_Y_OFFSET_FROM_FOOT
    expect(add.ellipse).toHaveBeenCalledWith(
      10,
      footY,
      32,
      16,
      HERO_CONFIGS.triss.tint,
      1,
    )

    const sprite = add.sprite.mock.results[0]?.value as { setTint: ReturnType<typeof vi.fn> }
    expect(sprite).toBeDefined()
    expect(add.sprite.mock.calls[0]![2]).toBe("triss")
    const heroTints = [HERO_CONFIGS.yen.tint, HERO_CONFIGS.triss.tint]
    for (const c of heroTints) {
      expect(sprite.setTint).not.toHaveBeenCalledWith(c)
    }
  })

  it("uses the selected hero frame size when cropping lava-submerged sprites", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    const lava = sampleLavaRect()

    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      heroId: "triss",
      x: lava.point.x,
      y: lava.point.y,
      terrainState: "lava",
    })]))
    sys.update(20, { up: false, down: false, left: false, right: false })

    const add = scene.add as { sprite: ReturnType<typeof vi.fn> }
    const sprite = add.sprite.mock.results[0]!.value as { setCrop: ReturnType<typeof vi.fn> }
    expect(sprite.setCrop).toHaveBeenCalledWith(0, 0, 124, 70)
  })

  it("reports local reconciliation corrections to the runtime bridge", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const corrections: string[] = []
    sys.localPlayerId = "p1"
    sys.setPredictionCorrectionHandler((correction) => {
      corrections.push(correction)
    })
    sys.applyFullSync(sync([snap({ id: 1, playerId: "p1", x: 10, y: 10 })]))

    sys.onLocalAck(1, {
      x: 200,
      y: 200,
      lastProcessedInputSeq: 0,
    })

    expect(corrections).toEqual(["snap"])
  })

  it("uses owner ACK replay context instead of stale client state for local replay", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    const start = sampleRightwardPredictionStart()
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: start.x,
      y: start.y,
      moveState: "idle",
      terrainState: "land",
    })]))
    for (let seq = 1; seq <= 10; seq++) {
      sys.localInputHistory.append(input({ seq, right: true }))
    }

    sys.onLocalAck(1, {
      x: start.x,
      y: start.y,
      lastProcessedInputSeq: 0,
      replayContext: {
        moveState: "idle",
        terrainState: "land",
        castingAbilityId: null,
        jumpZ: 0,
        jumpStartedInLava: false,
        isSwinging: false,
        hasSwiftBoots: true,
      },
    })

    const baseStep = BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC
    const simAfter = sys._getLocalSimForTest(1)
    expect(simAfter?.simCurrX).toBeCloseTo(
      start.x + baseStep * (1 + SWIFT_BOOTS_SPEED_BONUS) * 10,
      5,
    )
    expect(simAfter?.simCurrY).toBe(start.y)
  })

  it("renders remote players from the interpolation buffer after a snapshot", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "local-player"

    const now = Date.now()
    sys.applyFullSync({
      players: [snap({ id: 1, playerId: "remote", x: 0, y: 0 })],
      fireballs: [],
      seq: 0,
      serverTimeMs: now,
    })

    // Two remote snapshots straddling the render time; the buffer should
    // interpolate between them and land near the midpoint.
    sys.onRemoteSnapshot(1, {
      serverTimeMs: now,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facingAngle: 0,
      moveFacingAngle: 0,
    })
    sys.onRemoteSnapshot(1, {
      serverTimeMs: now + 100,
      x: 100,
      y: 0,
      vx: 0,
      vy: 0,
      facingAngle: 0,
      moveFacingAngle: 0,
    })

    // Default net timing assumes 30 Hz visual batches, so the render path
    // samples about 84 ms behind estimated server time.
    vi.setSystemTime(new Date(now + 134))
    sys.update(0, { up: false, down: false, left: false, right: false })

    expect(ClientRenderPos[1].x).toBeGreaterThan(0)
    expect(ClientRenderPos[1].x).toBeLessThan(100)
  })

  it("uses full-sync net timing to choose the remote interpolation sample time", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "local-player"

    const now = Date.now()
    sys.applyFullSync({
      players: [snap({ id: 1, playerId: "remote", x: 0, y: 0 })],
      fireballs: [],
      seq: 0,
      serverTimeMs: now,
      timing: {
        protocolVersion: 1,
        tickRateHz: 60,
        tickMs: 1000 / 60,
        netSendRateHz: 60,
        netSendIntervalMs: 1000 / 60,
        remoteRenderDelayMs: 50,
      },
    })
    sys.onRemoteSnapshot(1, {
      serverTimeMs: now,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facingAngle: 0,
      moveFacingAngle: 0,
    })
    sys.onRemoteSnapshot(1, {
      serverTimeMs: now + 100,
      x: 100,
      y: 0,
      vx: 0,
      vy: 0,
      facingAngle: 0,
      moveFacingAngle: 0,
    })

    vi.setSystemTime(new Date(now + 100))
    sys.update(0, { up: false, down: false, left: false, right: false })

    expect(ClientRenderPos[1].x).toBeCloseTo(50, 5)
  })

  it("keeps facing-only remote updates visible over older interpolation samples", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "local-player"

    const now = Date.now()
    sys.applyFullSync({
      players: [snap({
        id: 1,
        playerId: "remote",
        x: 0,
        y: 0,
        facingAngle: 0,
        moveFacingAngle: 0,
      })],
      fireballs: [],
      seq: 0,
      serverTimeMs: now,
    })

    ClientPlayerState[1]!.animState = "light_cast"
    ClientPlayerState[1]!.facingAngle = Math.PI
    ClientPlayerState[1]!.moveFacingAngle = Math.PI

    vi.setSystemTime(new Date(now + 134))
    sys.update(0, { up: false, down: false, left: false, right: false })

    const sprite = scene.add.sprite.mock.results[0]?.value as {
      play: ReturnType<typeof vi.fn>
    }
    expect(ClientPlayerState[1]!.facingAngle).toBe(Math.PI)
    expect(sprite.play).toHaveBeenCalledWith(
      getHeroAnimKey("yen", "light_cast", getDirectionFromAngle(Math.PI)),
      true,
    )
  })

  it("keeps the legacy batch-received compatibility hook as a no-op", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)

    expect(() => sys.markBatchReceived()).not.toThrow()
  })

  it("snaps the local player to the replayed target on large ack errors", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
    })]))
    // Reconciliation operates on fixed-step sim state; drive the sim
    // forward by seeding simCurr far ahead of the ack so the error lands
    // well above PREDICTION_SNAP_THRESHOLD_PX.
    sys._setLocalSimForTest(1, {
      simPrevX: OPEN_TEST_POINT.x + 500,
      simPrevY: OPEN_TEST_POINT.y,
      simCurrX: OPEN_TEST_POINT.x + 500,
      simCurrY: OPEN_TEST_POINT.y,
    })

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 0,
    })

    const simAfter = sys._getLocalSimForTest(1)
    expect(simAfter).not.toBeNull()
    // Snap collapses both simPrev and simCurr onto the replay target so
    // the next render step does not interpolate through the correction.
    expect(simAfter).toMatchObject({
      simPrevX: OPEN_TEST_POINT.x,
      simPrevY: OPEN_TEST_POINT.y,
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
      smoothRemainingMs: 0,
    })
    expect(ClientRenderPos[1]).toEqual({
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
    })
  })

  it("runs exactly one sim step per TICK_MS of real time and calls onSimStep once per step", () => {
    // Regression for cause B: committed sim cadence must match the
    // server's TICK_MS, not the client's frame delta. Under held W
    // over 3 × TICK_MS of frame delta, exactly three sim steps must
    // fire — each committing one TICK_DT_SEC of forward motion — and
    // the onSimStep callback must fire once per committed step (that
    // is how Arena sends one input per server tick regardless of FPS).
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
    })]))

    const start = sys._getLocalSimForTest(1)
    expect(start).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
    })

    let sends = 0
    // Use a clean 51 ms (slightly above 3 × TICK_MS = 50) so float
    // precision at the accumulator boundary cannot eat a step.
    sys.update(
      51,
      { up: true, down: false, left: false, right: false },
      () => {
        sends += 1
      },
    )

    expect(sends).toBe(3)
    const after = sys._getLocalSimForTest(1)
    // 3 sim steps × (BASE_MOVE_SPEED_PX_PER_SEC × TICK_DT_SEC) of
    // forward motion = 3 × 3.333… ≈ 10 px up (y decreases).
    expect(after?.simCurrY).toBeCloseTo(OPEN_TEST_POINT.y - 10, 5)
  })

  it("uses Swift Boots speed for live local fixed-step prediction after full sync", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      hasSwiftBoots: true,
    })]))

    sys.update(17, { up: false, down: false, left: false, right: true })

    const after = sys._getLocalSimForTest(1)
    expect(after?.simCurrX).toBeCloseTo(
      OPEN_TEST_POINT.x +
        BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC * (1 + SWIFT_BOOTS_SPEED_BONUS),
      5,
    )
    expect(after?.simCurrY).toBeCloseTo(OPEN_TEST_POINT.y, 5)
  })

  it("skips remote entries and uses grounded jump defaults for local prediction", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    const remoteStart = {
      x: OPEN_TEST_POINT.x + 40,
      y: OPEN_TEST_POINT.y,
    }
    sys.applyFullSync(sync([
      snap({
        id: 1,
        playerId: "p1",
        x: OPEN_TEST_POINT.x,
        y: OPEN_TEST_POINT.y,
      }),
      snap({
        id: 2,
        playerId: "p2",
        x: remoteStart.x,
        y: remoteStart.y,
      }),
    ]))
    ClientPlayerState[1]!.jumpZ = undefined as never

    sys.update(17, { up: false, down: false, left: false, right: true })

    expect(sys._getLocalSimForTest(1)?.simCurrX).toBeCloseTo(
      OPEN_TEST_POINT.x + BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC,
      5,
    )
    expect(sys._getLocalSimForTest(2)).toMatchObject({
      simCurrX: remoteStart.x,
      simCurrY: remoteStart.y,
    })
  })

  it("uses server cast ids and legacy cast animations for local movement gating", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const rightIntent = { up: false, down: false, left: false, right: true }

    const serverLightning = snap({
      id: 1,
      playerId: "p1",
      castingAbilityId: "lightning_bolt",
    })
    expect(resolver._clientCastMoveMultiplier(serverLightning)).toBe(0)

    const legacyHeavy = snap({
      id: 1,
      playerId: "p1",
      animState: "heavy_cast",
    })
    expect(resolver._canPredictMovement(
      legacyHeavy,
      rightIntent,
      resolver._clientCastMoveMultiplier(legacyHeavy),
    )).toBe(false)

    const legacyLight = snap({
      id: 1,
      playerId: "p1",
      animState: "light_cast",
    })
    expect(resolver._canPredictMovement(
      legacyLight,
      rightIntent,
      resolver._clientCastMoveMultiplier(legacyLight),
    )).toBe(true)
  })

  it("does not predict a movement step on the same local tick that starts rooted lightning", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", null, "lightning_bolt", null, null],
    )
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      moveState: "idle",
      castingAbilityId: null,
    })]))

    const lightningInput = input({
      seq: 1,
      up: true,
      abilitySlot: 2,
      abilityTargetX: OPEN_TEST_POINT.x + 200,
      abilityTargetY: OPEN_TEST_POINT.y,
    })

    let sends = 0
    sys.update(
      17,
      { up: true, down: false, left: false, right: false },
      () => {
        sends += 1
      },
      () => lightningInput,
    )

    expect(sends).toBe(1)
    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
    })
  })

  it("keeps predicting movement on the same local tick that starts mobile fireball casts", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "lightning_bolt", null, null, null],
    )
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      moveState: "idle",
      castingAbilityId: null,
    })]))

    sys.update(
      17,
      { up: true, down: false, left: false, right: false },
      undefined,
      () => input({
        seq: 1,
        up: true,
        abilitySlot: 0,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
    )

    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC,
      5,
    )
  })

  it("does not root same-tick lightning prediction when the ability is still cooling down", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "lightning_bolt", null, null, null],
    )
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      moveState: "idle",
      castingAbilityId: null,
      abilityStates: {
        ...abilityStates(),
        lightning_bolt: {
          ...abilityStates().lightning_bolt,
          cooldownEndsAtServerTimeMs: Date.now() + 1_000,
          cooldownDurationMs: 4_000,
        },
      },
    })]))

    sys.update(
      17,
      { up: true, down: false, left: false, right: false },
      undefined,
      () => input({
        seq: 1,
        up: true,
        abilitySlot: 1,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
    )

    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC,
      5,
    )
  })

  it("keeps ACK replay aligned with a pending rooted lightning cast input", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const corrections: string[] = []
    sys.localPlayerId = "p1"
    sys.setPredictionCorrectionHandler((correction) => {
      corrections.push(correction)
    })
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", null, "lightning_bolt", null, null],
    )
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      moveState: "idle",
      castingAbilityId: null,
    })]))

    const lightningInput = input({
      seq: 1,
      up: true,
      abilitySlot: 2,
      abilityTargetX: OPEN_TEST_POINT.x + 200,
      abilityTargetY: OPEN_TEST_POINT.y,
    })

    sys.update(
      17,
      { up: true, down: false, left: false, right: false },
      (fullInput) => {
        if (fullInput) sys.localInputHistory.append(fullInput)
      },
      () => lightningInput,
    )
    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
    })

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 0,
      replayContext: {
        moveState: "idle",
        terrainState: "land",
        castingAbilityId: null,
        jumpZ: 0,
        jumpStartedInLava: false,
        isSwinging: false,
        hasSwiftBoots: false,
      },
    })

    expect(corrections).toEqual(["none"])
    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
      smoothRemainingMs: 0,
    })
  })

  it("keeps ACK replay moving for pending mobile fireball cast inputs", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const corrections: string[] = []
    sys.localPlayerId = "p1"
    sys.setPredictionCorrectionHandler((correction) => {
      corrections.push(correction)
    })
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", null, "lightning_bolt", null, null],
    )
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      moveState: "idle",
      castingAbilityId: null,
    })]))

    const fireballInput = input({
      seq: 1,
      up: true,
      abilitySlot: 0,
      abilityTargetX: OPEN_TEST_POINT.x + 200,
      abilityTargetY: OPEN_TEST_POINT.y,
    })

    sys.update(
      17,
      { up: true, down: false, left: false, right: false },
      (fullInput) => {
        if (fullInput) sys.localInputHistory.append(fullInput)
      },
      () => fireballInput,
    )
    const predicted = sys._getLocalSimForTest(1)
    expect(predicted?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC,
      5,
    )

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 0,
      replayContext: {
        moveState: "idle",
        terrainState: "land",
        castingAbilityId: null,
        jumpZ: 0,
        jumpStartedInLava: false,
        isSwinging: false,
        hasSwiftBoots: false,
      },
    })

    expect(corrections).toEqual(["none"])
    expect(sys._getLocalSimForTest(1)?.smoothRemainingMs).toBe(0)
  })

  it("keeps authoritative ACK replay context when it is already casting or rooted", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", null, "lightning_bolt", null, null],
    )
    const state = snap({ id: 1, playerId: "p1" })
    const lightningInput = input({ seq: 1, abilitySlot: 2 })

    const castingCtx = replayCtx({
      castingAbilityId: "fireball",
      moveState: "casting",
    })
    expect(
      resolver._localReplayContextForInput(
        state,
        lightningInput,
        castingCtx,
      ),
    ).toBe(castingCtx)

    const rootedCtx = replayCtx({ moveState: "rooted" })
    expect(
      resolver._localReplayContextForInput(
        state,
        lightningInput,
        rootedCtx,
      ),
    ).toBe(rootedCtx)
  })

  it("resolves local ability slots through the React-owned registry with the legacy slot-0 fallback", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver

    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["lightning_bolt", null, "homing_orb"],
    )

    expect(resolver._abilityIdForSlot(0)).toBe("lightning_bolt")
    expect(resolver._abilityIdForSlot(1)).toBeNull()
    expect(resolver._abilityIdForSlot(2)).toBe("homing_orb")

    registryValues.delete(WW_ABILITY_SLOTS_REGISTRY_KEY)
    expect(resolver._abilityIdForSlot(0)).toBe("fireball")
    expect(resolver._abilityIdForSlot(1)).toBeNull()
  })

  it("only applies same-tick cast movement prediction when the outbound cast can start", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", null, "homing_orb", "missing_ability"],
    )

    const castInput = input({ seq: 1, abilitySlot: 0 })
    const validState = snap({ id: 1, playerId: "p1" })

    expect(resolver._localCastAbilityIdForInput(validState, null)).toBeNull()
    expect(
      resolver._localCastAbilityIdForInput(
        validState,
        input({ seq: 1, abilitySlot: null }),
      ),
    ).toBeNull()
    expect(resolver._localCastAbilityIdForInput(validState, castInput)).toBe(
      "fireball",
    )
    expect(
      resolver._localCastAbilityIdForInput(
        snap({
          id: 1,
          playerId: "p1",
          abilityStates: {
            ...abilityStates(),
            fireball: {
              ...abilityStates().fireball,
              cooldownEndsAtServerTimeMs: undefined as never,
            },
          },
        }),
        castInput,
      ),
    ).toBe("fireball")
    expect(
      resolver._localCastAbilityIdForInput(
        validState,
        input({ seq: 1, abilitySlot: 2 }),
      ),
    ).toBe("homing_orb")
    expect(
      resolver._localCastAbilityIdForInput(
        snap({
          id: 1,
          playerId: "p1",
          animState: "jump",
          jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX,
        }),
        castInput,
      ),
    ).toBe("fireball")
    expect(
      resolver._localCastAbilityIdForInput(
        {
          ...snap({ id: 1, playerId: "p1", animState: "jump" }),
          jumpZ: undefined as never,
        },
        castInput,
      ),
    ).toBe("fireball")

    const blockedStates: ReadonlyArray<{
      readonly name: string
      readonly state: PlayerSnapshot
      readonly payload?: PlayerInputPayload
    }> = [
      { name: "dying", state: snap({ id: 1, playerId: "p1", animState: "dying" }) },
      { name: "dead", state: snap({ id: 1, playerId: "p1", animState: "dead" }) },
      {
        name: "light cast",
        state: snap({ id: 1, playerId: "p1", animState: "light_cast" }),
      },
      {
        name: "heavy cast",
        state: snap({ id: 1, playerId: "p1", animState: "heavy_cast" }),
      },
      {
        name: "server cast in progress",
        state: snap({
          id: 1,
          playerId: "p1",
          castingAbilityId: "fireball",
        }),
      },
      {
        name: "airborne jump",
        state: snap({
          id: 1,
          playerId: "p1",
          animState: "jump",
          jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1,
        }),
      },
      {
        name: "empty slot",
        state: validState,
        payload: input({ seq: 1, abilitySlot: 1 }),
      },
      {
        name: "unknown ability",
        state: validState,
        payload: input({ seq: 1, abilitySlot: 3 }),
      },
      {
        name: "cooling down",
        state: snap({
          id: 1,
          playerId: "p1",
          abilityStates: {
            ...abilityStates(),
            fireball: {
              ...abilityStates().fireball,
              cooldownEndsAtServerTimeMs: Date.now() + 1_000,
            },
          },
        }),
      },
      {
        name: "out of charges",
        state: snap({
          id: 1,
          playerId: "p1",
          abilityStates: {
            ...abilityStates(),
            homing_orb: {
              ...abilityStates().homing_orb,
              charges: 0,
            },
          },
        }),
        payload: input({ seq: 1, abilitySlot: 2 }),
      },
    ]

    for (const blocked of blockedStates) {
      expect(
        resolver._localCastAbilityIdForInput(
          blocked.state,
          blocked.payload ?? castInput,
        ),
        blocked.name,
      ).toBeNull()
    }
  })

  it("bounds sim catch-up after a long hitch (no spiral of death)", () => {
    // If the tab was backgrounded or the thread GC-paused for a full
    // second, we clamp the accumulator to MAX_SIM_LAG_MS (250 ms in
    // the system) so the render frame after the hitch commits at most
    // ~15 sim steps, not 60+.
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
    })]))

    let sends = 0
    sys.update(
      5000,
      { up: false, down: false, left: false, right: false },
      () => {
        sends += 1
      },
    )
    // Clamp to 250 ms budget → at most 250 / 16.67 ≈ 15 sim steps.
    expect(sends).toBeLessThanOrEqual(15)
  })

  it("slides local prediction along non-walkable terrain instead of entering it", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    const { start } = sampleDiagonalSlideCase()
    sys.applyFullSync(sync([snap({ id: 1, playerId: "p1", x: start.x, y: start.y })]))

    sys.update(20, { up: true, down: false, left: false, right: true })

    const after = sys._getLocalSimForTest(1)
    expect(after?.simCurrX).toBeGreaterThan(start.x)
    expect(after?.simCurrY).toBeLessThanOrEqual(start.y)
  })

  it("keeps local lava prediction inside lava instead of walking onto land", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    const lava = sampleLavaRect()
    const start = {
      x: lava.point.x,
      y: lava.point.y,
    }
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: start.x,
      y: start.y,
      terrainState: "lava",
    })]))

    sys.update(400, { up: false, down: false, left: false, right: true })

    const after = sys._getLocalSimForTest(1)
    expect(after).not.toBeNull()
    expect(terrainStateAtPosition(after!.simCurrX, after!.simCurrY)).toBe("lava")
    expect(after!.simCurrX).toBeLessThanOrEqual(lava.point.x)
  })

  it("snaps to a legal smooth target when blocker-gated smoothing cannot reach it", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    const { start, target } = sampleBlockedSmoothingCase()
    sys.applyFullSync(sync([snap({ id: 1, playerId: "p1", x: start.x, y: start.y })]))

    const entry = (sys as unknown as {
      entries: Map<number, TestRenderEntry>
    }).entries.get(1)
    expect(entry).toBeDefined()
    entry!.smoothRemainingMs = REPLAY_SMOOTHING_MS
    entry!.smoothTargetX = target.x
    entry!.smoothTargetY = target.y

    sys.update(REPLAY_SMOOTHING_MS + 20, {
      up: false,
      down: false,
      left: false,
      right: false,
    })

    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: target.x,
      simCurrY: target.y,
      smoothRemainingMs: 0,
    })
  })
})

describe("PlayerRenderSystem smoothing + render interp", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"))
    for (const id of [...clientEntities]) {
      removeEntity(id)
      delete ClientPosition[id]
      delete ClientRenderPos[id]
      delete ClientPlayerState[id]
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps forward prediction during a smooth correction window instead of sliding backward", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    sys.applyFullSync(sync([snap({ id: 1, playerId: "p1", x: 0, y: 0 })]))
    // Seed simCurr 10 px ahead of the server in the W (up = -y)
    // direction — medium prediction error in the "smooth" band (above
    // INVISIBLE_PREDICTION_ERROR_PX, below PREDICTION_SNAP_THRESHOLD_PX).
    sys._setLocalSimForTest(1, {
      simPrevX: OPEN_TEST_POINT.x,
      simPrevY: OPEN_TEST_POINT.y - 10,
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y - 10,
    })

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 0,
    })
    // Smooth arms the correction toward (0, 0); simCurr is untouched
    // until the next sim step runs.
    const armed = sys._getLocalSimForTest(1)
    expect(armed).toMatchObject({ simCurrY: OPEN_TEST_POINT.y - 10 })
    expect(armed?.smoothRemainingMs).toBeGreaterThan(0)

    const startSimY = armed?.simCurrY ?? 0
    // Drive enough real-time debt to commit exactly one sim step so the
    // assertion runs against a freshly-committed simCurr regardless of
    // fractional accumulator.
    sys.update(20, { up: true, down: false, left: false, right: false })

    const after = sys._getLocalSimForTest(1)
    // Prediction-first blend (lerp(pPred, smoothTarget, t)): the
    // predicted step decreases y (forward) and is only partially pulled
    // back toward the target, so the committed simCurr.y must stay
    // below startSimY. With the old absolute from→to rail this would
    // have slid backward toward zero even under held W.
    expect(after?.simCurrY).toBeLessThan(startSimY)
  })

  it("ignores local ACKs when required ECS state is absent", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    sys.applyFullSync(sync([snap({ id: 1, playerId: "p1", x: 10, y: 20 })]))

    delete ClientPlayerState[1]
    expect(() =>
      sys.onLocalAck(1, { x: 10, y: 20, lastProcessedInputSeq: 0 }),
    ).not.toThrow()

    sys.applyFullSync(sync([snap({ id: 1, playerId: "p1", x: 10, y: 20 })]))
    delete ClientRenderPos[1]
    expect(() =>
      sys.onLocalAck(1, { x: 10, y: 20, lastProcessedInputSeq: 0 }),
    ).not.toThrow()
  })

  it("does not pull the render backward after release when prediction matches the ack (cause B + C)", () => {
    // Regression for the video the user reported: under the full
    // Option-3 fix, released-WASD with correct prediction must NOT
    // produce a pull-back over the smoothing window. Arming the
    // smoothing window only happens when reconcileLocal classifies
    // the error as "smooth"; with prediction matching the ack the
    // classification is "none" and no smoothing is armed, so the
    // render stays still.
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
    })]))
    // Simulate a steady 60 Hz frame: one sim step of forward motion
    // then an ack that exactly matches the committed simCurr.
    sys.update(
      1000 / 60,
      { up: true, down: false, left: false, right: false },
    )
    const afterStep = sys._getLocalSimForTest(1)
    expect(afterStep).not.toBeNull()
    const expectedY = afterStep!.simCurrY

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: expectedY,
      lastProcessedInputSeq: 0,
    })

    // Reconciliation should classify "none" (zero error) — no
    // smoothing armed.
    expect(sys._getLocalSimForTest(1)?.smoothRemainingMs).toBe(0)

    // Release WASD and run a few more frames.
    const stoppedBaseline = sys._getLocalSimForTest(1)?.simCurrY
    for (let i = 0; i < 5; i++) {
      sys.update(1000 / 60, { up: false, down: false, left: false, right: false })
    }
    const afterRelease = sys._getLocalSimForTest(1)?.simCurrY

    // simCurr must be unchanged after release — no pull-back.
    expect(afterRelease).toBe(stoppedBaseline)
  })
})

/**
 * Minimal primary-melee payload for {@link PlayerRenderSystem.onPrimaryMeleeSwing} tests.
 *
 * @param over - Field overrides.
 * @returns Payload satisfying {@link PrimaryMeleeAttackPayload}.
 */
function meleeSwingPayload(
  over: Partial<PrimaryMeleeAttackPayload> = {},
): PrimaryMeleeAttackPayload {
  return {
    casterId: "p1",
    attackId: "yen_cleaver",
    x: 0,
    y: 0,
    facingAngle: 0,
    damage: 10,
    hurtboxRadiusPx: 80,
    hurtboxArcDeg: 90,
    durationMs: 200,
    dangerousWindowStartMs: 0,
    dangerousWindowEndMs: 200,
    ...over,
  }
}

describe("PlayerRenderSystem.onPrimaryMeleeSwing", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"))
    for (const id of [...clientEntities]) {
      removeEntity(id)
      delete ClientPosition[id]
      delete ClientRenderPos[id]
      delete ClientPlayerState[id]
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("calls sprite.play with ignoreIfPlaying false twice when the same anim key repeats (held melee)", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    sys.applyFullSync(
      sync([
        snap({
          id: 1,
          playerId: "p1",
          heroId: "triss",
          x: OPEN_TEST_POINT.x,
          y: OPEN_TEST_POINT.y,
          facingAngle: 0,
        }),
      ]),
    )

    const spriteFn = scene.add.sprite as ReturnType<typeof vi.fn>
    const sprite = spriteFn.mock.results[0]!.value as { play: ReturnType<typeof vi.fn> }
    sprite.play.mockClear()

    const expectedKey = getHeroAnimKey(
      "triss",
      "primary_melee_attack",
      getDirectionFromAngle(0),
    )

    sys.onPrimaryMeleeSwing(meleeSwingPayload({ facingAngle: 0 }))
    sys.onPrimaryMeleeSwing(meleeSwingPayload({ facingAngle: 0 }))

    expect(sprite.play).toHaveBeenCalledTimes(2)
    expect(sprite.play.mock.calls[0]).toEqual([expectedKey, false])
    expect(sprite.play.mock.calls[1]).toEqual([expectedKey, false])
  })

  it("keeps the payload melee direction while state facing changes mid-swing", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    sys.applyFullSync(
      sync([
        snap({
          id: 1,
          playerId: "p1",
          x: OPEN_TEST_POINT.x,
          y: OPEN_TEST_POINT.y,
          animState: "primary_melee_attack",
          facingAngle: 0,
        }),
      ]),
    )

    const spriteFn = scene.add.sprite as ReturnType<typeof vi.fn>
    const sprite = spriteFn.mock.results[0]!.value as { play: ReturnType<typeof vi.fn> }
    const eastSwingKey = getHeroAnimKey(
      "yen",
      "primary_melee_attack",
      getDirectionFromAngle(0),
    )
    const westSwingKey = getHeroAnimKey(
      "yen",
      "primary_melee_attack",
      getDirectionFromAngle(Math.PI),
    )

    sys.onPrimaryMeleeSwing(meleeSwingPayload({ facingAngle: 0 }))
    expect(sprite.play).toHaveBeenLastCalledWith(eastSwingKey, false)

    sprite.play.mockClear()
    ClientPlayerState[1]!.facingAngle = Math.PI
    sys.update(0, { up: false, down: false, left: false, right: false })

    expect(sprite.play).not.toHaveBeenCalled()

    ClientPlayerState[1]!.animState = "idle"
    sys.update(0, { up: false, down: false, left: false, right: false })
    sprite.play.mockClear()

    ClientPlayerState[1]!.animState = "primary_melee_attack"
    sys.update(0, { up: false, down: false, left: false, right: false })

    expect(sprite.play).toHaveBeenLastCalledWith(westSwingKey, true)
  })

  it("no-ops when casterId does not match any spawned player", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    sys.applyFullSync(
      sync([
        snap({
          id: 1,
          playerId: "p1",
          x: OPEN_TEST_POINT.x,
          y: OPEN_TEST_POINT.y,
        }),
      ]),
    )

    const spriteFn = scene.add.sprite as ReturnType<typeof vi.fn>
    const sprite = spriteFn.mock.results[0]!.value as { play: ReturnType<typeof vi.fn> }
    sprite.play.mockClear()

    expect(() =>
      sys.onPrimaryMeleeSwing(meleeSwingPayload({ casterId: "unknown-caster" })),
    ).not.toThrow()
    expect(sprite.play).not.toHaveBeenCalled()
  })

  it("does not throw when the scene is shutting down (Phaser status SHUTDOWN)", () => {
    const { scene, group } = mockSceneAndGroup()
    ;(scene as { sys?: { settings: { status: number } } }).sys = {
      settings: { status: Phaser.Scenes.SHUTDOWN },
    }
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    sys.applyFullSync(
      sync([
        snap({
          id: 1,
          playerId: "p1",
          x: OPEN_TEST_POINT.x,
          y: OPEN_TEST_POINT.y,
          facingAngle: 0,
        }),
      ]),
    )

    const spriteFn = scene.add.sprite as ReturnType<typeof vi.fn>
    const sprite = spriteFn.mock.results[0]!.value as { play: ReturnType<typeof vi.fn> }
    sprite.play.mockClear()

    expect(() => sys.onPrimaryMeleeSwing(meleeSwingPayload({ facingAngle: 0 }))).not.toThrow()
    expect(sprite.play).not.toHaveBeenCalled()
  })
})

describe("PlayerRenderSystem.computeHeroHudYOffsets", () => {
  it("keeps 3px between nametag bottom and HP bar top, and 10px from sprite top to bar bottom", () => {
    const footY = 200
    const { nameTagBottomY, hpBarTopY } = computeHeroHudYOffsets(footY)
    const spriteTopY = footY - LADY_WIZARD_FRAME_HEIGHT_PX
    const hpBarHeight = 4
    expect(nameTagBottomY).toBe(hpBarTopY - NAME_TO_HP_BAR_GAP_PX)
    expect(hpBarTopY + hpBarHeight).toBe(spriteTopY - HUD_CLEARANCE_ABOVE_SPRITE_TOP_PX)
  })
})

describe("PlayerRenderSystem.shouldShowFireballChannel", () => {
  it("returns true when light_cast is paired with fireball-style channel spells", () => {
    expect(
      PlayerRenderSystem.shouldShowFireballChannel({
        animState: "light_cast",
        castingAbilityId: "fireball",
      }),
    ).toBe(true)
    expect(
      PlayerRenderSystem.shouldShowFireballChannel({
        animState: "light_cast",
        castingAbilityId: "homing_orb",
      }),
    ).toBe(true)
  })

  it("returns false on any mismatch (animState wrong, ability wrong, or null)", () => {
    expect(
      PlayerRenderSystem.shouldShowFireballChannel({
        animState: "idle",
        castingAbilityId: "fireball",
      }),
    ).toBe(false)
    expect(
      PlayerRenderSystem.shouldShowFireballChannel({
        animState: "light_cast",
        castingAbilityId: "lightning_bolt",
      }),
    ).toBe(false)
    expect(
      PlayerRenderSystem.shouldShowFireballChannel({
        animState: "light_cast",
        castingAbilityId: null,
      }),
    ).toBe(false)
    expect(
      PlayerRenderSystem.shouldShowFireballChannel({
        animState: "heavy_cast",
        castingAbilityId: "fireball",
      }),
    ).toBe(false)
  })
})
