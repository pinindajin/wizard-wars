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
import type { LocalAckState, LocalReplayContext } from "./ReconciliationSystem"
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
  JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX,
  JUMP_GRAVITY_PX_PER_SEC2,
  JUMP_INITIAL_VZ_PX_PER_SEC,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
  SWING_MOVE_SPEED_MULTIPLIER,
  SWIFT_BOOTS_SPEED_BONUS,
  TICK_DT_SEC,
  TICK_MS,
  getSpellAnimationConfig,
} from "@/shared/balance-config"
import { ABILITY_CONFIGS } from "@/shared/balance-config/abilities"
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
  localPredictedCast: {
    abilityId: string
    startedInputSeq: number
    totalTicks: number
    remainingTicks: number
  } | null
  localPredictedCastReplayWindow: {
    abilityId: string
    startedInputSeq: number
    totalTicks: number
  } | null
  localPredictedCastReplayWindows: Array<{
    abilityId: string
    startedInputSeq: number
    totalTicks: number
  }>
  localPredictedPrimaryMeleeSwing: {
    startedInputSeq: number
    totalTicks: number
  } | null
  localPredictedAbilityCooldowns: Map<
    string,
    {
      endsAtServerTimeMs: number
      startedInputSeq?: number
    }
  >
  localPredictedAbilityCharges: Map<
    string,
    Array<{
      startedInputSeq: number
      remainingChargesAfterReservation: number
    }>
  >
  _activeLocalPredictedCastAbilityId: (
    state: PlayerSnapshot,
  ) => string | null
  _startLocalPredictedCast: (
    state: PlayerSnapshot,
    input: PlayerInputPayload,
    abilityId: string,
  ) => void
  _localPredictedCastTicks: (
    state: PlayerSnapshot,
    abilityId: string,
  ) => number
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
  _localReplayContextResolver: (
    state: PlayerSnapshot,
    ctx: LocalReplayContext,
  ) => (input: PlayerInputPayload, baseCtx: LocalReplayContext) => LocalReplayContext
  _localPredictedPrimaryMeleeActiveForInput: (
    state: PlayerSnapshot,
    input: PlayerInputPayload | null,
  ) => boolean
  _shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement: (
    state: PlayerSnapshot,
    input: PlayerInputPayload | null,
  ) => boolean
  _startLocalPredictedPrimaryMeleeSwing: (
    state: PlayerSnapshot,
    input: PlayerInputPayload,
  ) => void
  _clearLocalPredictedAbilityGuardsForInput: (
    abilityId: string,
    startedInputSeq: number,
  ) => void
  _clearLocalPredictedCastFromAck: (
    state: PlayerSnapshot,
    ack: LocalAckState,
    ctx: LocalReplayContext,
  ) => void
  _reconcileLocalPredictedAbilityGuardsFromAuthority: (
    state: PlayerSnapshot,
    ack: LocalAckState,
    ctx: LocalReplayContext,
  ) => void
  _authoritativeAbilityCooldownReady: (
    runtime: PlayerSnapshot["abilityStates"][string] | undefined,
    currentServerTimeMs: number,
  ) => boolean
  _hasAbilityActiveInPredictionOrAuthority: (
    state: PlayerSnapshot,
    abilityId: string,
    ctx: LocalReplayContext,
  ) => boolean
  _hasAuthoritativeAbilityActiveOrCooldown: (
    state: PlayerSnapshot,
    abilityId: string,
    ctx: LocalReplayContext,
    currentServerTimeMs: number,
  ) => boolean
  _localPredictionTerrainContext: (
    state: PlayerSnapshot,
    activeLocalCastAbilityId: string | null,
    activeLocalPredictedCast: LocalCastResolver["localPredictedCast"],
  ) => {
    readonly jumpZ: number
    readonly terrainState: PlayerSnapshot["terrainState"]
    readonly jumpStartedInLava: boolean
  }
  _replayContextAfterPredictedCast: (
    ctx: LocalReplayContext,
    cast: {
      abilityId: string
      startedInputSeq: number
      totalTicks: number
    },
  ) => LocalReplayContext
  _shouldStartLocalPredictedPrimaryMeleeSwingForReplay: (
    state: PlayerSnapshot,
    input: PlayerInputPayload,
    activeSwing: {
      startedInputSeq: number
      totalTicks: number
    } | null,
    ctx: LocalReplayContext,
  ) => boolean
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
    registry: {
      get: vi.fn((key: string) => registryValues.get(key)),
      set: vi.fn((key: string, value: unknown) => {
        registryValues.set(key, value)
      }),
    },
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

  it("ignores ACKs and sim ticks when local render bookkeeping is missing", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    expect(() => {
      sys.onLocalAck(404, {
        x: 0,
        y: 0,
        lastProcessedInputSeq: 0,
        replayContext: replayCtx(),
      })
    }).not.toThrow()

    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
    })]))
    delete ClientPlayerState[1]

    expect(() => {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        undefined,
        () => input({ seq: 1, up: true }),
      )
    }).not.toThrow()
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

  it("draws low-health bars through the red-to-yellow color ramp", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: 10,
      y: 20,
      health: 4,
      maxHealth: 10,
    })]))
    sys.update(0, { up: false, down: false, left: false, right: false })

    const graphics = scene.add.graphics as ReturnType<typeof vi.fn>
    const hpBar = graphics.mock.results[0]!.value as { fillStyle: ReturnType<typeof vi.fn> }
    expect(hpBar.fillStyle).toHaveBeenCalledWith(0xffff00, 1)
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

  it("uses grounded jump defaults when ACK fallback context has missing jump fields", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const corrections: string[] = []
    sys.localPlayerId = "p1"
    sys.setPredictionCorrectionHandler((correction) => {
      corrections.push(correction)
    })
    sys.applyFullSync(sync([snap({ id: 1, playerId: "p1", x: 10, y: 10 })]))
    ClientPlayerState[1]!.jumpZ = undefined as never
    ClientPlayerState[1]!.jumpStartedInLava = undefined as never

    sys.onLocalAck(1, {
      x: 10,
      y: 10,
      lastProcessedInputSeq: 0,
    })

    expect(corrections).toEqual(["none"])
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
    ClientPlayerState[1]!.jumpStartedInLava = undefined as never

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

  it("returns the local player's latest render position", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    expect(sys.getLocalPlayerRenderPos()).toBeNull()

    sys.localPlayerId = "p1"
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
    })]))

    expect(sys.getLocalPlayerRenderPos()).toEqual({
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
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

    const originalFireballConfig = ABILITY_CONFIGS.fireball
    try {
      ;(ABILITY_CONFIGS as Record<
        string,
        typeof originalFireballConfig | undefined
      >).fireball = undefined
      expect(resolver._clientCastMoveMultiplier(legacyLight)).toBe(0)
    } finally {
      ABILITY_CONFIGS.fireball = originalFireballConfig
    }

    for (const animState of ["dying", "dead"] as const) {
      const state = snap({ id: 1, playerId: "p1", animState })
      expect(resolver._canPredictMovement(
        state,
        rightIntent,
        resolver._clientCastMoveMultiplier(state),
      )).toBe(false)
    }
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

  it("carries predicted rooted lightning across follow-up movement ticks before ACK", () => {
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

    const inputs = [
      input({
        seq: 1,
        up: true,
        abilitySlot: 2,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
      input({ seq: 2, up: true }),
    ]

    for (const nextInput of inputs) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        (fullInput) => {
          if (fullInput) sys.localInputHistory.append(fullInput)
        },
        () => nextInput,
      )
    }

    expect(sys.localInputHistory.size()).toBe(2)
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

  it("keeps follow-up movement prediction active during mobile fireball casts before ACK", () => {
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

    const inputs = [
      input({
        seq: 1,
        up: true,
        abilitySlot: 0,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
      input({ seq: 2, up: true }),
    ]

    for (const nextInput of inputs) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        undefined,
        () => nextInput,
      )
    }

    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC * 2,
      5,
    )
  })

  it("keeps movement prediction active for jump ability inputs", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const corrections: string[] = []
    sys.localPlayerId = "p1"
    sys.setPredictionCorrectionHandler((correction) => {
      corrections.push(correction)
    })
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "jump", null, null, null],
    )
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      moveState: "idle",
      castingAbilityId: null,
    })]))

    const inputs = [
      input({
        seq: 1,
        up: true,
        abilitySlot: 1,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
      input({ seq: 2, up: true }),
    ]

    for (const nextInput of inputs) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        (fullInput) => {
          if (fullInput) sys.localInputHistory.append(fullInput)
        },
        () => nextInput,
      )
    }

    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC * 2,
      5,
    )

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 0,
      replayContext: replayCtx(),
    })
    expect(corrections).toEqual(["none"])
    expect(sys._getLocalSimForTest(1)?.smoothRemainingMs).toBe(0)
  })

  it("uses airborne terrain context on the same local tick that starts a lava jump", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "jump", null, null, null],
    )
    const lava = sampleLavaRect()
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: lava.point.x,
      y: lava.point.y,
      terrainState: "lava",
      jumpZ: 0,
      jumpStartedInLava: false,
      moveState: "idle",
      castingAbilityId: null,
    })]))

    sys.update(
      TICK_MS,
      { up: false, down: false, left: false, right: true },
      undefined,
      () => input({
        seq: 1,
        right: true,
        abilitySlot: 1,
        abilityTargetX: lava.point.x + 200,
        abilityTargetY: lava.point.y,
      }),
    )

    expect(sys._getLocalSimForTest(1)?.simCurrX).toBeGreaterThan(lava.point.x)
  })

  it("keeps ACK replay aligned for pending lava jump movement", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const corrections: string[] = []
    sys.localPlayerId = "p1"
    sys.setPredictionCorrectionHandler((correction) => {
      corrections.push(correction)
    })
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "jump", null, null, null],
    )
    const lava = sampleLavaRect()
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: lava.point.x,
      y: lava.point.y,
      terrainState: "lava",
      jumpZ: 0,
      jumpStartedInLava: false,
      moveState: "idle",
      castingAbilityId: null,
    })]))

    sys.update(
      TICK_MS,
      { up: false, down: false, left: false, right: true },
      (fullInput) => {
        if (fullInput) sys.localInputHistory.append(fullInput)
      },
      () => input({
        seq: 1,
        right: true,
        abilitySlot: 1,
        abilityTargetX: lava.point.x + 200,
        abilityTargetY: lava.point.y,
      }),
    )
    const predicted = sys._getLocalSimForTest(1)
    expect(predicted?.simCurrX).toBeGreaterThan(lava.point.x)

    sys.onLocalAck(1, {
      x: lava.point.x,
      y: lava.point.y,
      lastProcessedInputSeq: 0,
      replayContext: replayCtx({
        terrainState: "lava",
        jumpZ: 0,
        jumpStartedInLava: false,
      }),
    })

    expect(corrections).toEqual(["none"])
    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: predicted!.simCurrX,
      simCurrY: predicted!.simCurrY,
      smoothRemainingMs: 0,
    })
  })

  it("keeps follow-up ability casts blocked while a local jump air-lock is pending", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "jump", "lightning_bolt", null, null],
    )
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      moveState: "idle",
      castingAbilityId: null,
    })]))

    const inputs = [
      input({
        seq: 1,
        up: true,
        abilitySlot: 1,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
      input({
        seq: 2,
        up: true,
        abilitySlot: 2,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
    ]

    for (const nextInput of inputs) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        undefined,
        () => nextInput,
      )
    }

    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC * 2,
      5,
    )
  })

  it("keeps local jump air-lock after ACK confirms airborne jump before batch state arrives", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "jump", "lightning_bolt", null, null],
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
      TICK_MS,
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

    const oneMoveTickY =
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC
    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: oneMoveTickY,
      lastProcessedInputSeq: 1,
      replayContext: replayCtx({
        jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1,
      }),
    })

    sys.update(
      TICK_MS,
      { up: true, down: false, left: false, right: false },
      undefined,
      () => input({
        seq: 2,
        up: true,
        abilitySlot: 2,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
    )

    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC * 2,
      5,
    )
  })

  it("does not predict jump air-lock when server-side swing rejects the jump input", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "jump", "lightning_bolt", null, null],
    )
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      animState: "primary_melee_attack",
      moveState: "swinging",
      castingAbilityId: null,
    })]))

    const inputs = [
      input({
        seq: 1,
        up: true,
        abilitySlot: 1,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
      input({
        seq: 2,
        up: true,
        abilitySlot: 2,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
    ]

    for (const nextInput of inputs) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        undefined,
        () => nextInput,
      )
    }

    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y -
        BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC * SWING_MOVE_SPEED_MULTIPLIER,
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

  it("expires predicted lightning root when no authoritative cast arrives", () => {
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
      heroId: "yen",
      moveState: "idle",
      castingAbilityId: null,
    })]))

    const lightningCastTicks = Math.ceil(
      getSpellAnimationConfig("yen", "lightning_bolt").durationMs / TICK_MS,
    )
    for (let seq = 1; seq <= lightningCastTicks; seq += 1) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        undefined,
        () => input({
          seq,
          up: true,
          abilitySlot: seq === 1 ? 2 : null,
          abilityTargetX: OPEN_TEST_POINT.x + 200,
          abilityTargetY: OPEN_TEST_POINT.y,
        }),
      )
    }

    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
    })

    sys.update(
      TICK_MS,
      { up: true, down: false, left: false, right: false },
      undefined,
      () => input({
        seq: lightningCastTicks + 1,
        up: true,
      }),
    )

    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC,
      5,
    )
  })

  it("rejects repeated local casts during the predicted cooldown after cast expiry", () => {
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
      heroId: "yen",
      moveState: "idle",
      castingAbilityId: null,
    })]))

    const lightningCastTicks = Math.ceil(
      getSpellAnimationConfig("yen", "lightning_bolt").durationMs / TICK_MS,
    )
    for (let seq = 1; seq <= lightningCastTicks; seq += 1) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        undefined,
        () => input({
          seq,
          up: true,
          abilitySlot: seq === 1 ? 2 : null,
          abilityTargetX: OPEN_TEST_POINT.x + 200,
          abilityTargetY: OPEN_TEST_POINT.y,
        }),
      )
    }

    sys.update(
      TICK_MS,
      { up: true, down: false, left: false, right: false },
      undefined,
      () => input({
        seq: lightningCastTicks + 1,
        up: true,
        abilitySlot: 2,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
    )

    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC,
      5,
    )
  })

  it("replays original pending casts after local cast expiry without treating the predicted cooldown as authoritative", () => {
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
      heroId: "yen",
      moveState: "idle",
      castingAbilityId: null,
    })]))

    const lightningCastTicks = Math.ceil(
      getSpellAnimationConfig("yen", "lightning_bolt").durationMs / TICK_MS,
    )
    for (let seq = 1; seq <= lightningCastTicks; seq += 1) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        (fullInput) => {
          if (fullInput) sys.localInputHistory.append(fullInput)
        },
        () => input({
          seq,
          up: true,
          abilitySlot: seq === 1 ? 2 : null,
          abilityTargetX: OPEN_TEST_POINT.x + 200,
          abilityTargetY: OPEN_TEST_POINT.y,
        }),
      )
    }
    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
    })

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 0,
      replayContext: replayCtx(),
    })

    expect(corrections).toEqual(["none"])
    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
      smoothRemainingMs: 0,
    })
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

  it("replays a live predicted lightning cast from its original duration after a delayed ACK", () => {
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
      heroId: "yen",
      moveState: "idle",
      castingAbilityId: null,
    })]))

    const lightningCastTicks = Math.ceil(
      getSpellAnimationConfig("yen", "lightning_bolt").durationMs / TICK_MS,
    )
    for (let seq = 1; seq < lightningCastTicks; seq += 1) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        (fullInput) => {
          if (fullInput) sys.localInputHistory.append(fullInput)
        },
        () => input({
          seq,
          up: true,
          abilitySlot: seq === 1 ? 2 : null,
          abilityTargetX: OPEN_TEST_POINT.x + 200,
          abilityTargetY: OPEN_TEST_POINT.y,
        }),
      )
    }
    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
    })

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 0,
      replayContext: replayCtx(),
    })

    expect(corrections).toEqual(["none"])
    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
      smoothRemainingMs: 0,
    })
  })

  it("replays movement after the final rooted lightning ACK tick at normal speed", () => {
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
      heroId: "yen",
      moveState: "idle",
      castingAbilityId: null,
    })]))

    const lightningCastTicks = Math.ceil(
      getSpellAnimationConfig("yen", "lightning_bolt").durationMs / TICK_MS,
    )
    for (let seq = 1; seq <= lightningCastTicks + 1; seq += 1) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        (fullInput) => {
          if (fullInput) sys.localInputHistory.append(fullInput)
        },
        () => input({
          seq,
          up: true,
          abilitySlot: seq === 1 ? 2 : null,
          abilityTargetX: OPEN_TEST_POINT.x + 200,
          abilityTargetY: OPEN_TEST_POINT.y,
        }),
      )
    }

    const expectedAfterFirstPostCastMove =
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC
    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      expectedAfterFirstPostCastMove,
      5,
    )

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: lightningCastTicks,
      replayContext: replayCtx({
        castingAbilityId: "lightning_bolt",
        moveState: "rooted",
      }),
    })

    expect(corrections).toEqual(["none"])
    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: expectedAfterFirstPostCastMove,
      smoothRemainingMs: 0,
    })
  })

  it("predicts primary melee movement slowdown after the swing start tick", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      heroId: "yen",
      moveState: "idle",
      animState: "idle",
      castingAbilityId: null,
    })]))

    for (let seq = 1; seq <= 2; seq += 1) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        (fullInput) => {
          if (fullInput) sys.localInputHistory.append(fullInput)
        },
        () => input({
          seq,
          up: true,
          weaponPrimary: true,
          weaponTargetX: OPEN_TEST_POINT.x + 200,
          weaponTargetY: OPEN_TEST_POINT.y,
        }),
      )
    }

    const fullSpeedStep = BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC
    const slowedStep = fullSpeedStep * SWING_MOVE_SPEED_MULTIPLIER
    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - fullSpeedStep - slowedStep,
      5,
    )
  })

  it("lets authoritative melee state take over local melee slowdown", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    sys.localPlayerId = "p1"
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      heroId: "yen",
      moveState: "idle",
      animState: "idle",
      castingAbilityId: null,
    })]))

    sys.update(
      TICK_MS,
      { up: true, down: false, left: false, right: false },
      undefined,
      () => input({
        seq: 1,
        up: true,
        weaponPrimary: true,
        weaponTargetX: OPEN_TEST_POINT.x + 200,
        weaponTargetY: OPEN_TEST_POINT.y,
      }),
    )
    expect(resolver.localPredictedPrimaryMeleeSwing?.startedInputSeq).toBe(1)

    ClientPlayerState[1]!.animState = "primary_melee_attack"
    ClientPlayerState[1]!.moveState = "swinging"
    sys.update(
      TICK_MS,
      { up: true, down: false, left: false, right: false },
      undefined,
      () => input({
        seq: 2,
        up: true,
        weaponPrimary: true,
        weaponTargetX: OPEN_TEST_POINT.x + 200,
        weaponTargetY: OPEN_TEST_POINT.y,
      }),
    )

    const fullSpeedStep = BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC
    const slowedStep = fullSpeedStep * SWING_MOVE_SPEED_MULTIPLIER
    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - fullSpeedStep - slowedStep,
      5,
    )
    expect(resolver.localPredictedPrimaryMeleeSwing?.startedInputSeq).toBe(1)
  })

  it("uses ACK-relative server time when replay checks pending input cooldowns", () => {
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
      abilityStates: {
        ...abilityStates(),
        lightning_bolt: {
          ...abilityStates().lightning_bolt,
          cooldownEndsAtServerTimeMs: 1_000,
          cooldownDurationMs: 4_000,
        },
      },
    })]))

    vi.setSystemTime(900)
    sys.update(
      TICK_MS,
      { up: true, down: false, left: false, right: false },
      (fullInput) => {
        if (fullInput) sys.localInputHistory.append(fullInput)
      },
      () => input({
        seq: 1,
        up: true,
        abilitySlot: 2,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
    )
    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC,
      5,
    )

    vi.setSystemTime(2_000)
    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 0,
      serverTimeMs: 900,
      replayContext: replayCtx(),
    } as LocalAckState & { readonly serverTimeMs: number })

    expect(corrections).toEqual(["none"])
    expect(sys._getLocalSimForTest(1)?.smoothRemainingMs).toBe(0)
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

  it("derives ACK replay cast context from pending history without live predicted state", () => {
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
    sys.localInputHistory.append(input({
      seq: 1,
      up: true,
      abilitySlot: 2,
      abilityTargetX: OPEN_TEST_POINT.x + 200,
      abilityTargetY: OPEN_TEST_POINT.y,
    }))

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 0,
      replayContext: replayCtx(),
    })

    expect(corrections).toEqual(["none"])
    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
      smoothRemainingMs: 0,
    })
  })

  it("replays pending ability inputs through the current slot mapping", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const pendingInput = input({ seq: 1, abilitySlot: 2 })
    const baseCtx = replayCtx()
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", null, null, null, null],
    )

    expect(
      resolver._localReplayContextForInput(
        snap({ id: 1, playerId: "p1" }),
        pendingInput,
        baseCtx,
      ),
    ).toBe(baseCtx)

    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", null, "lightning_bolt", null, null],
    )
    expect(
      resolver._localReplayContextForInput(
        snap({ id: 1, playerId: "p1" }),
        pendingInput,
        replayCtx(),
      ),
    ).toMatchObject({
      castingAbilityId: "lightning_bolt",
      moveState: "rooted",
    })
  })

  it("clears predicted lightning when ACK processes the cast without casting context", () => {
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

    sys.update(
      TICK_MS,
      { up: true, down: false, left: false, right: false },
      (fullInput) => {
        if (fullInput) sys.localInputHistory.append(fullInput)
      },
      () => input({
        seq: 1,
        up: true,
        abilitySlot: 2,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
    )

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 1,
      replayContext: replayCtx(),
    })
    sys.update(
      TICK_MS,
      { up: true, down: false, left: false, right: false },
      undefined,
      () => input({ seq: 2, up: true }),
    )

    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC,
      5,
    )
  })

  it("keeps predicted lightning after ACK confirms casting before batch state arrives", () => {
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

    const inputs = [
      input({
        seq: 1,
        up: true,
        abilitySlot: 2,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
      input({ seq: 2, up: true }),
    ]
    for (const nextInput of inputs) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        (fullInput) => {
          if (fullInput) sys.localInputHistory.append(fullInput)
        },
        () => nextInput,
      )
    }

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 1,
      replayContext: replayCtx({
        castingAbilityId: "lightning_bolt",
        moveState: "rooted",
      }),
    })
    sys.update(
      TICK_MS,
      { up: true, down: false, left: false, right: false },
      undefined,
      () => input({ seq: 3, up: true }),
    )

    expect(corrections).toEqual(["none"])
    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
      smoothRemainingMs: 0,
    })
  })

  it("keeps ACK replay on the first predicted cast when a later cast edge is pending", () => {
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

    const inputs = [
      input({
        seq: 1,
        up: true,
        abilitySlot: 0,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
      input({
        seq: 2,
        up: true,
        abilitySlot: 2,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
    ]

    for (const nextInput of inputs) {
      sys.update(
        TICK_MS,
        { up: true, down: false, left: false, right: false },
        (fullInput) => {
          if (fullInput) sys.localInputHistory.append(fullInput)
        },
        () => nextInput,
      )
    }
    expect(sys._getLocalSimForTest(1)?.simCurrY).toBeCloseTo(
      OPEN_TEST_POINT.y - BASE_MOVE_SPEED_PX_PER_SEC * TICK_DT_SEC * 2,
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

  it("clears predicted casts on authoritative state and destroy", () => {
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
    sys.update(
      TICK_MS,
      { up: true, down: false, left: false, right: false },
      undefined,
      () => input({
        seq: 1,
        up: true,
        abilitySlot: 2,
        abilityTargetX: OPEN_TEST_POINT.x + 200,
        abilityTargetY: OPEN_TEST_POINT.y,
      }),
    )

    ClientPlayerState[1]!.castingAbilityId = "lightning_bolt"
    ClientPlayerState[1]!.moveState = "rooted"
    sys.update(
      TICK_MS,
      { up: true, down: false, left: false, right: false },
      undefined,
      () => input({ seq: 2, up: true }),
    )

    expect(sys._getLocalSimForTest(1)).toMatchObject({
      simCurrX: OPEN_TEST_POINT.x,
      simCurrY: OPEN_TEST_POINT.y,
    })
    expect(() => sys.destroy()).not.toThrow()
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

    const airborneCtx = replayCtx({
      jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1,
    })
    expect(
      resolver._localReplayContextForInput(
        state,
        lightningInput,
        airborneCtx,
      ),
    ).toBe(airborneCtx)
  })

  it("keeps unrelated authoritative ACK contexts ahead of predicted replay windows", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", null, "lightning_bolt", null, null],
    )
    resolver.localPredictedCast = {
      abilityId: "lightning_bolt",
      startedInputSeq: 1,
      totalTicks: 2,
      remainingTicks: 2,
    }
    const state = snap({ id: 1, playerId: "p1" })
    const lightningInput = input({ seq: 1, abilitySlot: 2 })

    const castingCtx = replayCtx({
      castingAbilityId: "fireball",
      moveState: "casting",
    })
    expect(
      resolver._localReplayContextResolver(state, castingCtx)(
        lightningInput,
        castingCtx,
      ),
    ).toBe(castingCtx)

    const rootedCtx = replayCtx({ moveState: "rooted" })
    expect(
      resolver._localReplayContextResolver(state, rootedCtx)(
        lightningInput,
        rootedCtx,
      ),
    ).toBe(rootedCtx)

    const airborneCtx = replayCtx({
      jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1,
    })
    expect(
      resolver._localReplayContextResolver(state, airborneCtx)(
        lightningInput,
        airborneCtx,
      ),
    ).toBe(airborneCtx)

    resolver.localPredictedCast = {
      abilityId: "lightning_bolt",
      startedInputSeq: 2,
      totalTicks: 2,
      remainingTicks: 2,
    }
    const matchingCtx = replayCtx({
      castingAbilityId: "lightning_bolt",
      moveState: "rooted",
    })
    expect(
      resolver._localReplayContextResolver(state, matchingCtx)(
        input({ seq: 1 }),
        matchingCtx,
      ),
    ).toBe(matchingCtx)
  })

  it("cleans up stale predicted cast state and builds idle replay contexts", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", null, "lightning_bolt", null, null],
    )
    const state = snap({ id: 1, playerId: "p1" })
    resolver.localPredictedCast = {
      abilityId: "lightning_bolt",
      startedInputSeq: 1,
      totalTicks: 1,
      remainingTicks: 0,
    }

    expect(resolver._activeLocalPredictedCastAbilityId(state)).toBeNull()
    expect(resolver.localPredictedCast).toBeNull()

    const idleCtx = replayCtx()
    expect(
      resolver._localReplayContextForInput(
        state,
        input({ seq: 1, abilitySlot: null }),
        idleCtx,
      ),
    ).toBe(idleCtx)

    expect(
      resolver._localReplayContextForInput(
        state,
        input({ seq: 1, abilitySlot: 2 }),
        replayCtx(),
      ),
    ).toMatchObject({
      castingAbilityId: "lightning_bolt",
      moveState: "rooted",
    })
  })

  it("bounds post-cast replay context to the predicted cast sequence window", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const castWindow = {
      abilityId: "lightning_bolt",
      startedInputSeq: 1,
      totalTicks: 2,
    }

    const mismatchedCtx = replayCtx({
      castingAbilityId: "fireball",
      moveState: "casting",
    })
    expect(
      resolver._replayContextAfterPredictedCast(mismatchedCtx, castWindow),
    ).toBe(mismatchedCtx)
    expect(
      resolver._replayContextAfterPredictedCast(
        replayCtx({
          castingAbilityId: "lightning_bolt",
          moveState: "rooted",
        }),
        castWindow,
      ),
    ).toMatchObject({
      castingAbilityId: null,
      moveState: "idle",
    })
    expect(
      resolver._replayContextAfterPredictedCast(
        replayCtx({
          castingAbilityId: "lightning_bolt",
          moveState: "casting",
        }),
        castWindow,
      ),
    ).toMatchObject({
      castingAbilityId: null,
      moveState: "idle",
    })
    expect(
      resolver._replayContextAfterPredictedCast(
        replayCtx({
          castingAbilityId: "lightning_bolt",
          moveState: "idle",
        }),
        castWindow,
      ),
    ).toMatchObject({
      castingAbilityId: null,
      moveState: "idle",
    })
  })

  it("retains older unacknowledged cast replay windows when later casts start", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const state = snap({ id: 1, playerId: "p1" })

    expect(resolver.localPredictedCastReplayWindow).toBeNull()
    resolver.localPredictedCastReplayWindows = [
      { abilityId: "lightning_bolt", startedInputSeq: 1, totalTicks: 2 },
      { abilityId: "fireball", startedInputSeq: 4, totalTicks: 2 },
    ]
    expect(resolver.localPredictedCastReplayWindow).toMatchObject({
      abilityId: "fireball",
      startedInputSeq: 4,
    })
    resolver.localPredictedCastReplayWindow = {
      abilityId: "lightning_bolt",
      startedInputSeq: 1,
      totalTicks: 2,
    }
    resolver.localPredictedCastReplayWindow = null
    expect(resolver.localPredictedCastReplayWindows).toEqual([])
    resolver.localPredictedCastReplayWindows = [
      { abilityId: "lightning_bolt", startedInputSeq: 1, totalTicks: 2 },
      { abilityId: "fireball", startedInputSeq: 4, totalTicks: 2 },
    ]

    expect(resolver.localPredictedCastReplayWindows).toMatchObject([
      { abilityId: "lightning_bolt", startedInputSeq: 1 },
      { abilityId: "fireball", startedInputSeq: 4 },
    ])

    const lightningAckCtx = replayCtx({
      castingAbilityId: "lightning_bolt",
      moveState: "rooted",
    })
    expect(
      resolver._localReplayContextResolver(state, lightningAckCtx)(
        input({ seq: 3, up: true }),
        lightningAckCtx,
      ),
    ).toMatchObject({
      castingAbilityId: null,
      moveState: "idle",
    })
  })

  it("replays local primary melee windows by input sequence", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const state = snap({ id: 1, playerId: "p1" })
    const baseCtx = replayCtx()
    const replayResolver = resolver._localReplayContextResolver(state, baseCtx)

    expect(
      replayResolver(
        input({ seq: 1, up: true, weaponPrimary: true }),
        baseCtx,
      ),
    ).toBe(baseCtx)
    expect(
      replayResolver(
        input({ seq: 2, up: true, weaponPrimary: true }),
        baseCtx,
      ),
    ).toMatchObject({ isSwinging: true })

    resolver.localPredictedPrimaryMeleeSwing = {
      startedInputSeq: 10,
      totalTicks: 2,
    }
    const seededReplayResolver = resolver._localReplayContextResolver(
      state,
      baseCtx,
    )
    expect(
      seededReplayResolver(input({ seq: 11, up: true }), baseCtx),
    ).toMatchObject({ isSwinging: true })
  })

  it("layers primary melee replay onto movable cast contexts", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const state = snap({ id: 1, playerId: "p1" })
    const movableCastCtx = replayCtx({
      castingAbilityId: "fireball",
      moveState: "casting",
    })
    const replayResolver = resolver._localReplayContextResolver(
      state,
      movableCastCtx,
    )

    expect(
      replayResolver(
        input({ seq: 1, up: true, weaponPrimary: true }),
        movableCastCtx,
      ),
    ).toBe(movableCastCtx)
    expect(
      replayResolver(input({ seq: 2, up: true }), movableCastCtx),
    ).toMatchObject({
      castingAbilityId: "fireball",
      moveState: "casting",
      isSwinging: true,
    })
  })

  it("does not locally predict primary melee in states the server rejects", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const state = snap({ id: 1, playerId: "p1" })
    const primaryInput = input({ seq: 1, weaponPrimary: true })

    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement(
        state,
        null,
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement(
        state,
        input({ seq: 1, weaponPrimary: false }),
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement(
        state,
        primaryInput,
      ),
    ).toBe(true)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement(
        snap({ id: 1, playerId: "p1", animState: "dying" }),
        primaryInput,
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement(
        snap({ id: 1, playerId: "p1", animState: "dead" }),
        primaryInput,
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement(
        snap({
          id: 1,
          playerId: "p1",
          animState: "jump",
          jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1,
        }),
        primaryInput,
      ),
    ).toBe(false)
    resolver.localPredictedCast = {
      abilityId: "jump",
      startedInputSeq: 1,
      totalTicks: 2,
      remainingTicks: 2,
    }
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement(
        state,
        primaryInput,
      ),
    ).toBe(false)
    resolver.localPredictedCast = null

    resolver.localPredictedPrimaryMeleeSwing = {
      startedInputSeq: 1,
      totalTicks: 3,
    }
    expect(
      resolver._localPredictedPrimaryMeleeActiveForInput(
        state,
        input({ seq: 2 }),
      ),
    ).toBe(true)
    expect(
      resolver._localPredictedPrimaryMeleeActiveForInput(
        snap({ id: 1, playerId: "p1", animState: "primary_melee_attack" }),
        input({ seq: 2 }),
      ),
    ).toBe(false)
    expect(
      resolver._localPredictedPrimaryMeleeActiveForInput(
        snap({ id: 1, playerId: "p1", moveState: "swinging" }),
        input({ seq: 2 }),
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement(
        state,
        input({ seq: 3, weaponPrimary: true }),
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement(
        state,
        input({ seq: 4, weaponPrimary: true }),
      ),
    ).toBe(true)
  })

  it("does not start primary melee replay in blocked replay contexts", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const state = snap({ id: 1, playerId: "p1" })
    const primaryInput = input({ seq: 1, weaponPrimary: true })
    const activeSwing = {
      startedInputSeq: 1,
      totalTicks: 3,
    }

    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingForReplay(
        state,
        input({ seq: 1, weaponPrimary: false }),
        null,
        replayCtx(),
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingForReplay(
        snap({ id: 1, playerId: "p1", animState: "dying" }),
        primaryInput,
        null,
        replayCtx(),
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingForReplay(
        snap({ id: 1, playerId: "p1", animState: "dead" }),
        primaryInput,
        null,
        replayCtx(),
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingForReplay(
        state,
        primaryInput,
        null,
        replayCtx({ jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1 }),
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingForReplay(
        state,
        primaryInput,
        null,
        replayCtx({ isSwinging: true }),
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingForReplay(
        state,
        primaryInput,
        null,
        replayCtx(),
      ),
    ).toBe(true)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingForReplay(
        state,
        input({ seq: 3, weaponPrimary: true }),
        activeSwing,
        replayCtx(),
      ),
    ).toBe(false)
    expect(
      resolver._shouldStartLocalPredictedPrimaryMeleeSwingForReplay(
        state,
        input({ seq: 4, weaponPrimary: true }),
        activeSwing,
        replayCtx(),
      ),
    ).toBe(true)
  })

  it("does not seed predicted cast blockers for unknown or zero-duration non-jump abilities", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const state = snap({ id: 1, playerId: "p1" })
    const instantAbilityId = "__test_instant_non_jump__"

    expect(resolver._localPredictedCastTicks(state, "missing_ability")).toBe(0)

    ABILITY_CONFIGS[instantAbilityId] = {
      ...ABILITY_CONFIGS.fireball,
      id: instantAbilityId,
      castMs: 0,
    }
    try {
      registryValues.set(
        WW_ABILITY_SLOTS_REGISTRY_KEY,
        [instantAbilityId, null, null, null, null],
      )
      expect(resolver._localPredictedCastTicks(state, instantAbilityId)).toBe(0)
      resolver._startLocalPredictedCast(
        state,
        input({ seq: 1, abilitySlot: 0 }),
        instantAbilityId,
      )
      expect(resolver.localPredictedCast).toBeNull()

      const baseCtx = replayCtx()
      const replayResolver = resolver._localReplayContextResolver(state, baseCtx)
      expect(
        replayResolver(input({ seq: 1, abilitySlot: 0 }), baseCtx),
      ).toBe(baseCtx)
    } finally {
      delete ABILITY_CONFIGS[instantAbilityId]
    }
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

  it("ignores stale send-time ability metadata when replaying pending inputs", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", null, null, null, null],
    )
    const staleInput = {
      ...input({ seq: 1, abilitySlot: 2 }),
      resolvedAbilityId: "lightning_bolt",
    } as PlayerInputPayload & { readonly resolvedAbilityId: string }
    const baseCtx = replayCtx()

    expect(
      resolver._localReplayContextForInput(
        snap({ id: 1, playerId: "p1" }),
        staleInput,
        baseCtx,
      ),
    ).toBe(baseCtx)
  })

  it("builds airborne terrain replay context for pending jump inputs", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "jump", null, null, null],
    )

    expect(
      resolver._localReplayContextForInput(
        snap({
          id: 1,
          playerId: "p1",
          terrainState: "lava",
          jumpZ: 0,
          jumpStartedInLava: false,
        }),
        input({ seq: 1, abilitySlot: 1 }),
        replayCtx({
          terrainState: "lava",
          jumpZ: 0,
          jumpStartedInLava: false,
        }),
      ),
    ).toMatchObject({
      castingAbilityId: null,
      moveState: "idle",
      terrainState: "land",
      jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1,
      jumpStartedInLava: true,
    })
  })

  it("advances predicted jump replay height with the server jump arc", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "jump", null, null, null],
    )
    const baseCtx = replayCtx()
    const replayResolver = resolver._localReplayContextResolver(
      snap({ id: 1, playerId: "p1" }),
      baseCtx,
    )

    const first = replayResolver(input({ seq: 1, abilitySlot: 1 }), baseCtx)
    let highestJumpZ = first.jumpZ
    for (let seq = 2; seq <= 120; seq++) {
      const ctx = replayResolver(input({ seq, right: true }), baseCtx)
      highestJumpZ = Math.max(highestJumpZ, ctx.jumpZ)
    }
    let expectedJumpZ = JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1
    let expectedVz = JUMP_INITIAL_VZ_PX_PER_SEC
    let expectedHighestJumpZ = expectedJumpZ
    while (expectedJumpZ > 0) {
      expectedVz -= JUMP_GRAVITY_PX_PER_SEC2 * TICK_DT_SEC
      expectedJumpZ += expectedVz * TICK_DT_SEC
      expectedHighestJumpZ = Math.max(expectedHighestJumpZ, expectedJumpZ)
    }

    expect(first).toMatchObject({
      jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1,
      terrainState: "land",
    })
    expect(highestJumpZ).toBeGreaterThan(
      JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1,
    )
    expect(highestJumpZ).toBeCloseTo(expectedHighestJumpZ, 5)
    if (expectedHighestJumpZ >= JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX) {
      expect(highestJumpZ).toBeGreaterThanOrEqual(
        JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX,
      )
    } else {
      expect(highestJumpZ).toBeLessThan(JUMP_AIRBORNE_LAVA_COLLISION_MIN_Z_PX)
    }
  })

  it("prunes expired local predicted cooldowns before accepting another cast", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", null, "lightning_bolt", null, null],
    )
    resolver.localPredictedAbilityCooldowns.set("lightning_bolt", {
      endsAtServerTimeMs: Date.now() - 1,
    })

    expect(
      resolver._localCastAbilityIdForInput(
        snap({ id: 1, playerId: "p1" }),
        input({ seq: 2, abilitySlot: 2 }),
      ),
    ).toBe("lightning_bolt")
    expect(resolver.localPredictedAbilityCooldowns.has("lightning_bolt")).toBe(
      false,
    )
  })

  it("clears a predicted cooldown when the server rejects the predicted cast", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
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
    })]))

    sys.update(
      TICK_MS,
      { up: false, down: false, left: false, right: false },
      undefined,
      () => input({ seq: 1, abilitySlot: 2 }),
    )

    expect(resolver.localPredictedCast?.abilityId).toBe("lightning_bolt")
    expect(resolver.localPredictedAbilityCooldowns.has("lightning_bolt")).toBe(
      true,
    )

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 1,
      replayContext: replayCtx(),
    })

    expect(resolver.localPredictedCast).toBeNull()
    expect(resolver.localPredictedAbilityCooldowns.has("lightning_bolt")).toBe(
      false,
    )
  })

  it("clears local predicted ability guards when the local player respawns", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
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
    })]))

    sys.update(
      TICK_MS,
      { up: false, down: false, left: false, right: false },
      undefined,
      () => input({ seq: 1, abilitySlot: 2 }),
    )
    expect(resolver.localPredictedAbilityCooldowns.has("lightning_bolt")).toBe(
      true,
    )

    sys.onPlayerRespawn({
      playerId: "p1",
      spawnX: OPEN_TEST_POINT.x + 10,
      spawnY: OPEN_TEST_POINT.y + 10,
      facingAngle: 0,
    })

    expect(resolver.localPredictedCast).toBeNull()
    expect(resolver.localPredictedAbilityCooldowns.size).toBe(0)
    expect(resolver.localPredictedAbilityCharges.size).toBe(0)
  })

  it("clears predicted cooldowns when fresh authority reports the ability ready", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
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
    })]))
    resolver.localPredictedAbilityCooldowns.set("lightning_bolt", {
      endsAtServerTimeMs: Date.now() + 1_000,
      startedInputSeq: 1,
    })

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 1,
      serverTimeMs: Date.now(),
      replayContext: replayCtx(),
      abilityStatesChanged: true,
    })

    expect(resolver.localPredictedAbilityCooldowns.has("lightning_bolt")).toBe(
      false,
    )
  })

  it("keeps predicted cooldowns when an ACK has no fresh ability state", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
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
    })]))
    resolver.localPredictedAbilityCooldowns.set("lightning_bolt", {
      endsAtServerTimeMs: Date.now() + 1_000,
      startedInputSeq: 1,
    })

    sys.onLocalAck(1, {
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      lastProcessedInputSeq: 1,
      serverTimeMs: Date.now(),
      replayContext: replayCtx(),
    })

    expect(resolver.localPredictedAbilityCooldowns.has("lightning_bolt")).toBe(
      true,
    )
  })

  it("reserves locally predicted jump charges until authority catches up", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    sys.localPlayerId = "p1"
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "jump", null, null, null],
    )
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      abilityStates: {
        ...abilityStates(),
        jump: {
          ...abilityStates().jump,
          charges: 1,
          maxCharges: 4,
        },
      },
    })]))

    sys.update(
      TICK_MS,
      { up: false, down: false, left: false, right: false },
      undefined,
      () => input({ seq: 1, abilitySlot: 1 }),
    )
    expect(resolver.localPredictedCast?.abilityId).toBe("jump")

    resolver.localPredictedCast = null
    sys.update(
      TICK_MS,
      { up: false, down: false, left: false, right: false },
      undefined,
      () => input({ seq: 2, abilitySlot: 1 }),
    )

    expect(resolver.localPredictedCast).toBeNull()
  })

  it("tracks multiple locally predicted charge spends against stale authority", () => {
    const { scene, group, registryValues } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    sys.localPlayerId = "p1"
    registryValues.set(
      WW_ABILITY_SLOTS_REGISTRY_KEY,
      ["fireball", "jump", null, null, null],
    )
    sys.applyFullSync(sync([snap({
      id: 1,
      playerId: "p1",
      x: OPEN_TEST_POINT.x,
      y: OPEN_TEST_POINT.y,
      abilityStates: {
        ...abilityStates(),
        jump: {
          ...abilityStates().jump,
          charges: 2,
          maxCharges: 4,
        },
      },
    })]))

    sys.update(
      TICK_MS,
      { up: false, down: false, left: false, right: false },
      undefined,
      () => input({ seq: 1, abilitySlot: 1 }),
    )
    expect(resolver.localPredictedCast?.startedInputSeq).toBe(1)

    resolver.localPredictedCast = null
    sys.update(
      TICK_MS,
      { up: false, down: false, left: false, right: false },
      undefined,
      () => input({ seq: 2, abilitySlot: 1 }),
    )
    expect(resolver.localPredictedCast).toMatchObject({ startedInputSeq: 2 })

    resolver.localPredictedCast = null
    sys.update(
      TICK_MS,
      { up: false, down: false, left: false, right: false },
      undefined,
      () => input({ seq: 3, abilitySlot: 1 }),
    )

    expect(resolver.localPredictedCast).toBeNull()
  })

  it("removes only the rejected local charge reservation for an ACKed input", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    resolver.localPredictedAbilityCooldowns.set("jump", {
      endsAtServerTimeMs: Date.now() + 1_000,
      startedInputSeq: 2,
    })
    resolver.localPredictedAbilityCharges.set("jump", [
      { startedInputSeq: 1, remainingChargesAfterReservation: 1 },
      { startedInputSeq: 2, remainingChargesAfterReservation: 0 },
    ])

    resolver._clearLocalPredictedAbilityGuardsForInput("jump", 2)
    expect(resolver.localPredictedAbilityCooldowns.has("jump")).toBe(false)
    expect(resolver.localPredictedAbilityCharges.get("jump")).toEqual([
      { startedInputSeq: 1, remainingChargesAfterReservation: 1 },
    ])

    resolver._clearLocalPredictedAbilityGuardsForInput("jump", 1)
    expect(resolver.localPredictedAbilityCharges.has("jump")).toBe(false)
  })

  it("keeps ready predicted cooldowns while a matching cast replay window is active", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const now = Date.now()
    resolver.localPredictedCastReplayWindow = {
      abilityId: "lightning_bolt",
      startedInputSeq: 1,
      totalTicks: 2,
    }
    resolver.localPredictedAbilityCooldowns.set("lightning_bolt", {
      endsAtServerTimeMs: now + 1_000,
      startedInputSeq: 1,
    })

    expect(
      resolver._hasAbilityActiveInPredictionOrAuthority(
        snap({ id: 1, playerId: "p1" }),
        "lightning_bolt",
        replayCtx(),
      ),
    ).toBe(true)

    resolver._reconcileLocalPredictedAbilityGuardsFromAuthority(
      snap({ id: 1, playerId: "p1" }),
      {
        x: 0,
        y: 0,
        lastProcessedInputSeq: 1,
        serverTimeMs: now,
        abilityStatesChanged: true,
      },
      replayCtx(),
    )
    expect(resolver.localPredictedAbilityCooldowns.has("lightning_bolt")).toBe(
      true,
    )

    resolver._clearLocalPredictedAbilityGuardsForInput("lightning_bolt", 1)
    expect(resolver.localPredictedCastReplayWindow).toBeNull()
    expect(resolver.localPredictedAbilityCooldowns.has("lightning_bolt")).toBe(
      false,
    )
  })

  it("clears a naturally finished cast replay window without rejecting its cooldown", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const now = Date.now()
    resolver.localPredictedCastReplayWindow = {
      abilityId: "lightning_bolt",
      startedInputSeq: 1,
      totalTicks: 2,
    }
    resolver.localPredictedAbilityCooldowns.set("lightning_bolt", {
      endsAtServerTimeMs: now + 1_000,
      startedInputSeq: 1,
    })

    resolver._clearLocalPredictedCastFromAck(
      snap({
        id: 1,
        playerId: "p1",
        abilityStates: {
          ...abilityStates(),
          lightning_bolt: {
            ...abilityStates().lightning_bolt,
            cooldownEndsAtServerTimeMs: now + 500,
          },
        },
      }),
      {
        x: 0,
        y: 0,
        lastProcessedInputSeq: 2,
        serverTimeMs: now,
        replayContext: replayCtx(),
      },
      replayCtx(),
    )

    expect(resolver.localPredictedCast).toBeNull()
    expect(resolver.localPredictedCastReplayWindow).toBeNull()
    expect(resolver.localPredictedAbilityCooldowns.has("lightning_bolt")).toBe(
      true,
    )
  })

  it("clears predicted guards when a late ACK shows the cast was rejected", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const now = Date.now()
    resolver.localPredictedCastReplayWindow = {
      abilityId: "lightning_bolt",
      startedInputSeq: 1,
      totalTicks: 2,
    }
    resolver.localPredictedAbilityCooldowns.set("lightning_bolt", {
      endsAtServerTimeMs: now + 1_000,
      startedInputSeq: 1,
    })
    resolver.localPredictedAbilityCharges.set("lightning_bolt", [
      { startedInputSeq: 1, remainingChargesAfterReservation: 0 },
    ])

    resolver._clearLocalPredictedCastFromAck(
      snap({ id: 1, playerId: "p1" }),
      {
        x: 0,
        y: 0,
        lastProcessedInputSeq: 2,
        serverTimeMs: now,
        replayContext: replayCtx(),
      },
      replayCtx(),
    )

    expect(resolver.localPredictedCast).toBeNull()
    expect(resolver.localPredictedCastReplayWindow).toBeNull()
    expect(resolver.localPredictedAbilityCooldowns.has("lightning_bolt")).toBe(
      false,
    )
    expect(resolver.localPredictedAbilityCharges.has("lightning_bolt")).toBe(
      false,
    )
  })

  it("reconciles predicted ability guards from fresh authoritative ability state", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const now = Date.now()
    const state = snap({
      id: 1,
      playerId: "p1",
      abilityStates: {
        ...abilityStates(),
        lightning_bolt: {
          ...abilityStates().lightning_bolt,
          cooldownEndsAtServerTimeMs: now + 500,
        },
        jump: {
          ...abilityStates().jump,
          charges: 1,
          maxCharges: 4,
        },
      },
    })
    resolver.localPredictedAbilityCooldowns.set("lightning_bolt", {
      endsAtServerTimeMs: now + 1_000,
      startedInputSeq: 1,
    })
    resolver.localPredictedAbilityCooldowns.set("fireball", {
      endsAtServerTimeMs: now + 1_000,
      startedInputSeq: 1,
    })
    resolver.localPredictedAbilityCooldowns.set("missing_ability", {
      endsAtServerTimeMs: now + 1_000,
      startedInputSeq: 1,
    })
    resolver.localPredictedAbilityCharges.set("fireball", [
      { startedInputSeq: 1, remainingChargesAfterReservation: 0 },
    ])
    resolver.localPredictedAbilityCharges.set("jump", [
      { startedInputSeq: 1, remainingChargesAfterReservation: 1 },
      { startedInputSeq: 2, remainingChargesAfterReservation: 0 },
    ])
    resolver.localPredictedAbilityCharges.set("homing_orb", [
      { startedInputSeq: 1, remainingChargesAfterReservation: 3 },
    ])

    resolver._reconcileLocalPredictedAbilityGuardsFromAuthority(
      state,
      {
        x: 0,
        y: 0,
        lastProcessedInputSeq: 2,
        serverTimeMs: now,
        abilityStatesChanged: true,
      },
      replayCtx(),
    )

    expect(resolver.localPredictedAbilityCooldowns.has("lightning_bolt")).toBe(
      false,
    )
    expect(resolver.localPredictedAbilityCooldowns.has("fireball")).toBe(false)
    expect(resolver.localPredictedAbilityCooldowns.has("missing_ability")).toBe(
      true,
    )
    expect(resolver.localPredictedAbilityCharges.has("fireball")).toBe(false)
    expect(resolver.localPredictedAbilityCharges.get("jump")).toEqual([
      { startedInputSeq: 2, remainingChargesAfterReservation: 0 },
    ])
    expect(resolver.localPredictedAbilityCharges.has("homing_orb")).toBe(false)
  })

  it("keeps ready predicted guards while matching authority or prediction is active", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const now = Date.now()

    resolver.localPredictedCast = {
      abilityId: "fireball",
      startedInputSeq: 1,
      totalTicks: 10,
      remainingTicks: 5,
    }
    expect(
      resolver._hasAbilityActiveInPredictionOrAuthority(
        snap({ id: 1, playerId: "p1" }),
        "fireball",
        replayCtx(),
      ),
    ).toBe(true)
    resolver.localPredictedCast = null

    expect(
      resolver._hasAbilityActiveInPredictionOrAuthority(
        snap({ id: 1, playerId: "p1", castingAbilityId: "fireball" }),
        "fireball",
        replayCtx(),
      ),
    ).toBe(true)
    expect(
      resolver._hasAbilityActiveInPredictionOrAuthority(
        snap({ id: 1, playerId: "p1" }),
        "fireball",
        replayCtx({ castingAbilityId: "fireball" }),
      ),
    ).toBe(true)
    expect(
      resolver._hasAbilityActiveInPredictionOrAuthority(
        snap({
          id: 1,
          playerId: "p1",
          animState: "jump",
          jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1,
        }),
        "jump",
        replayCtx(),
      ),
    ).toBe(true)
    expect(
      resolver._hasAbilityActiveInPredictionOrAuthority(
        snap({ id: 1, playerId: "p1" }),
        "jump",
        replayCtx({ jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1 }),
      ),
    ).toBe(true)
    expect(
      resolver._hasAbilityActiveInPredictionOrAuthority(
        snap({ id: 1, playerId: "p1", moveState: "rooted" }),
        "fireball",
        replayCtx(),
      ),
    ).toBe(true)
    expect(
      resolver._hasAbilityActiveInPredictionOrAuthority(
        snap({ id: 1, playerId: "p1" }),
        "fireball",
        replayCtx({ moveState: "casting" }),
      ),
    ).toBe(true)
    expect(
      resolver._hasAbilityActiveInPredictionOrAuthority(
        snap({ id: 1, playerId: "p1" }),
        "fireball",
        replayCtx(),
      ),
    ).toBe(false)

    resolver.localPredictedAbilityCooldowns.set("fireball", {
      endsAtServerTimeMs: now + 1_000,
      startedInputSeq: 1,
    })
    resolver._reconcileLocalPredictedAbilityGuardsFromAuthority(
      snap({ id: 1, playerId: "p1", castingAbilityId: "fireball" }),
      {
        x: 0,
        y: 0,
        lastProcessedInputSeq: 1,
        serverTimeMs: now,
        abilityStatesChanged: true,
      },
      replayCtx(),
    )
    expect(resolver.localPredictedAbilityCooldowns.has("fireball")).toBe(true)
  })

  it("detects authoritative accepted casts and cooldowns for predicted guard cleanup", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const now = Date.now()

    expect(
      resolver._hasAuthoritativeAbilityActiveOrCooldown(
        snap({ id: 1, playerId: "p1", castingAbilityId: "fireball" }),
        "fireball",
        replayCtx(),
        now,
      ),
    ).toBe(true)
    expect(
      resolver._hasAuthoritativeAbilityActiveOrCooldown(
        snap({ id: 1, playerId: "p1" }),
        "fireball",
        replayCtx({ castingAbilityId: "fireball" }),
        now,
      ),
    ).toBe(true)
    expect(
      resolver._hasAuthoritativeAbilityActiveOrCooldown(
        snap({
          id: 1,
          playerId: "p1",
          animState: "jump",
          jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1,
        }),
        "jump",
        replayCtx(),
        now,
      ),
    ).toBe(true)
    expect(
      resolver._hasAuthoritativeAbilityActiveOrCooldown(
        snap({ id: 1, playerId: "p1" }),
        "jump",
        replayCtx({ jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1 }),
        now,
      ),
    ).toBe(true)
    expect(
      resolver._hasAuthoritativeAbilityActiveOrCooldown(
        snap({
          id: 1,
          playerId: "p1",
          abilityStates: {
            ...abilityStates(),
            fireball: {
              ...abilityStates().fireball,
              cooldownEndsAtServerTimeMs: now + 1,
            },
          },
        }),
        "fireball",
        replayCtx(),
        now,
      ),
    ).toBe(true)
    expect(
      resolver._hasAuthoritativeAbilityActiveOrCooldown(
        snap({ id: 1, playerId: "p1" }),
        "fireball",
        replayCtx(),
        now,
      ),
    ).toBe(false)
    expect(
      resolver._hasAuthoritativeAbilityActiveOrCooldown(
        snap({ id: 1, playerId: "p1" }),
        "jump",
        replayCtx(),
        now,
      ),
    ).toBe(false)
  })

  it("classifies authoritative cooldown readiness and initial predicted jump terrain", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    const resolver = sys as unknown as LocalCastResolver
    const now = Date.now()

    expect(
      resolver._authoritativeAbilityCooldownReady(undefined, now),
    ).toBe(false)
    expect(
      resolver._authoritativeAbilityCooldownReady(
        { ...abilityStates().fireball, cooldownEndsAtServerTimeMs: null },
        now,
      ),
    ).toBe(true)
    expect(
      resolver._authoritativeAbilityCooldownReady(
        {
          ...abilityStates().fireball,
          cooldownEndsAtServerTimeMs: undefined as never,
        },
        now,
      ),
    ).toBe(true)
    expect(
      resolver._authoritativeAbilityCooldownReady(
        { ...abilityStates().fireball, cooldownEndsAtServerTimeMs: now },
        now,
      ),
    ).toBe(true)
    expect(
      resolver._authoritativeAbilityCooldownReady(
        { ...abilityStates().fireball, cooldownEndsAtServerTimeMs: now + 1 },
        now,
      ),
    ).toBe(false)

    expect(
      resolver._localPredictionTerrainContext(
        snap({ id: 1, playerId: "p1", terrainState: "lava" }),
        "jump",
        null,
      ),
    ).toMatchObject({
      jumpZ: JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1,
      terrainState: "land",
      jumpStartedInLava: true,
    })
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

  it("uses the scene animation manager fallback for authoritative melee replay", () => {
    const { scene, group } = mockSceneAndGroup()
    ;(scene as { anims?: object }).anims = {}
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
    const sprite = spriteFn.mock.results[0]!.value as {
      anims?: unknown
      play: ReturnType<typeof vi.fn>
    }
    sprite.anims = undefined
    sprite.play.mockClear()

    sys.onPrimaryMeleeSwing(meleeSwingPayload({ facingAngle: 0 }))

    expect(sprite.play).toHaveBeenCalledTimes(1)
  })

  it("skips authoritative melee replay when no animation manager is available", () => {
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
          facingAngle: 0,
        }),
      ]),
    )

    const spriteFn = scene.add.sprite as ReturnType<typeof vi.fn>
    const sprite = spriteFn.mock.results[0]!.value as {
      anims?: unknown
      play: ReturnType<typeof vi.fn>
    }
    sprite.anims = undefined
    sprite.play.mockClear()

    sys.onPrimaryMeleeSwing(meleeSwingPayload({ facingAngle: 0 }))

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
