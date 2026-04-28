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

import {
  computeHeroHudYOffsets,
  FOOT_MARKER_CENTER_Y_OFFSET_FROM_FOOT,
  HUD_CLEARANCE_ABOVE_SPRITE_TOP_PX,
  LADY_WIZARD_FRAME_HEIGHT_PX,
  NAME_TO_HP_BAR_GAP_PX,
  PlayerRenderSystem,
} from "./PlayerRenderSystem"
import { ClientPosition, ClientPlayerState, ClientRenderPos } from "../components"
import { clientEntities, removeEntity } from "../world"
import type { PlayerSnapshot } from "@/shared/types"
import { HERO_CONFIGS } from "@/shared/balance-config/heroes"
import {
  ARENA_SPAWN_POINTS,
  ARENA_WORLD_COLLIDERS,
  PLAYER_WORLD_COLLISION_OFFSET_Y_PX,
  PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
} from "@/shared/balance-config"
import { REPLAY_SMOOTHING_MS } from "@/shared/balance-config/rendering"

const OPEN_TEST_POINT = ARENA_SPAWN_POINTS[0]!

type TestRenderEntry = {
  smoothRemainingMs: number
  smoothTargetX: number
  smoothTargetY: number
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
    heroId: over.heroId ?? "red_wizard",
    animState: over.animState ?? "idle",
    moveState: over.moveState ?? "idle",
    castingAbilityId: over.castingAbilityId ?? null,
    invulnerable: over.invulnerable ?? false,
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
    add: {
      sprite: vi.fn((x: number, y: number) => {
        const sprite = {
          x,
          y,
          destroy: spriteDestroy,
          setOrigin: vi.fn(),
          setTint: vi.fn(),
          clearTint: vi.fn(),
          setDepth: vi.fn(),
          play: vi.fn(),
          setPosition: vi.fn((nextX: number, nextY: number) => {
            sprite.x = nextX
            sprite.y = nextY
            return sprite
          }),
          setAlpha: vi.fn(),
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

  return { scene, group, destroyed, spriteDestroy, textDestroy, gfxDestroy, ellipseDestroy }
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

  it("spawns a white-tint sprite, foot ellipse 32×16 in hero color, and never hero-tints the body", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    sys.applyFullSync(sync([snap({ id: 1, playerId: "p1", heroId: "red_wizard", x: 10, y: 20 })]))

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
      HERO_CONFIGS.red_wizard.tint,
      1,
    )

    const sprite = add.sprite.mock.results[0]?.value as { setTint: ReturnType<typeof vi.fn> }
    expect(sprite).toBeDefined()
    const heroTints = [HERO_CONFIGS.red_wizard.tint, HERO_CONFIGS.barbarian.tint, HERO_CONFIGS.ranger.tint]
    for (const c of heroTints) {
      expect(sprite.setTint).not.toHaveBeenCalledWith(c)
    }
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

    vi.setSystemTime(new Date(now + 83))
    sys.update(0, { up: false, down: false, left: false, right: false })

    expect(ClientRenderPos[1].x).toBeGreaterThan(0)
    expect(ClientRenderPos[1].x).toBeLessThan(100)
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
    const topStrip = ARENA_WORLD_COLLIDERS[0]!
    const topClearance = PLAYER_WORLD_COLLISION_RADIUS_Y_PX - PLAYER_WORLD_COLLISION_OFFSET_Y_PX
    const start = {
      x: topStrip.x + 704,
      y: topStrip.y + topStrip.height + topClearance,
    }
    sys.applyFullSync(sync([snap({ id: 1, playerId: "p1", x: start.x, y: start.y })]))

    sys.update(20, { up: true, down: false, left: false, right: true })

    const after = sys._getLocalSimForTest(1)
    expect(after?.simCurrX).toBeGreaterThan(start.x)
    expect(after?.simCurrY).toBe(start.y)
  })

  it("snaps to a legal smooth target when blocker-gated smoothing cannot reach it", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"
    const topStrip = ARENA_WORLD_COLLIDERS[0]!
    const topClearance = PLAYER_WORLD_COLLISION_RADIUS_Y_PX - PLAYER_WORLD_COLLISION_OFFSET_Y_PX
    const bottomClearance = PLAYER_WORLD_COLLISION_RADIUS_Y_PX + PLAYER_WORLD_COLLISION_OFFSET_Y_PX
    const start = {
      x: topStrip.x + 704,
      y: topStrip.y + topStrip.height + topClearance,
    }
    const target = {
      x: start.x,
      y: topStrip.y - bottomClearance,
    }
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
      simPrevX: target.x,
      simPrevY: target.y,
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
  it("returns true only when both light_cast AND castingAbilityId='fireball' hold", () => {
    expect(
      PlayerRenderSystem.shouldShowFireballChannel({
        animState: "light_cast",
        castingAbilityId: "fireball",
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
