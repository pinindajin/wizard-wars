import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("phaser", () => ({
  default: {
    Scenes: {
      RUNNING: 5,
      SHUTDOWN: 8,
      DESTROYED: 9,
    },
  },
}))

import {
  TELEGRAPH_DANGER_FILL_ALPHA,
  TELEGRAPH_DANGER_FILL_COLOR,
  TELEGRAPH_WINDUP_FILL_ALPHA,
  TELEGRAPH_WINDUP_FILL_COLOR,
} from "@/shared/balance-config"
import type { CombatTelegraphStartPayload } from "@/shared/types"
import { ClientPlayerState, ClientRenderPos } from "../components"
import { CombatTelegraphRenderSystem } from "./CombatTelegraphRenderSystem"

/** Phaser scene status numbers (see `node_modules/phaser/src/scene/const.js`). */
const SCENE_RUNNING = 5
const SCENE_SHUTDOWN = 8

function clearClientPlayerBuffers(): void {
  for (const k of Object.keys(ClientPlayerState)) {
    const n = Number(k)
    if (Number.isFinite(n)) delete ClientPlayerState[n]
  }
  for (const k of Object.keys(ClientRenderPos)) {
    const n = Number(k)
    if (Number.isFinite(n)) delete ClientRenderPos[n]
  }
}

function baseConePayload(over: Partial<CombatTelegraphStartPayload> = {}): CombatTelegraphStartPayload {
  return {
    id: "t1",
    casterId: "u1",
    sourceId: "test",
    anchor: "caster",
    directionRad: 0,
    shape: { type: "cone", radiusPx: 50, arcDeg: 180 },
    startsAtServerTimeMs: 1_000,
    dangerStartsAtServerTimeMs: 2_000,
    dangerEndsAtServerTimeMs: 3_000,
    endsAtServerTimeMs: 3_000,
    ...over,
  }
}

function mockGraphics() {
  return {
    destroy: vi.fn(),
    clear: vi.fn(),
    setDepth: vi.fn(),
    fillStyle: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fillPath: vi.fn(),
    fillCircle: vi.fn(),
  }
}

function wireCaster(casterId: string, x: number, y: number): void {
  ClientPlayerState[1] = {
    playerId: casterId,
    username: "n",
    heroId: "red_wizard",
    health: 10,
    maxHealth: 10,
    lives: 3,
    animState: "idle",
    moveState: "idle",
    terrainState: "land",
    castingAbilityId: null,
    facingAngle: 0,
    moveFacingAngle: 0,
    invulnerable: false,
    jumpZ: 0,
    jumpStartedInLava: false,
  }
  ClientRenderPos[1] = { x, y }
}

describe("CombatTelegraphRenderSystem", () => {
  beforeEach(() => {
    clearClientPlayerBuffers()
    vi.clearAllMocks()
  })

  it("draws lighter-red wind-up fill after startsAt and before dangerStarts", () => {
    const gfx = mockGraphics()
    const scene = { add: { graphics: vi.fn(() => gfx) } }
    const sys = new CombatTelegraphRenderSystem(scene as never)
    wireCaster("u1", 100, 200)
    sys.start(baseConePayload())
    sys.update(1_500) // after starts, before danger
    expect(gfx.clear).toHaveBeenCalled()
    expect(gfx.fillStyle).toHaveBeenCalledWith(TELEGRAPH_WINDUP_FILL_COLOR, TELEGRAPH_WINDUP_FILL_ALPHA)
    expect(gfx.fillPath).toHaveBeenCalled()
  })

  it("draws no fill before startsAtServerTimeMs (only clear)", () => {
    const gfx = mockGraphics()
    const scene = { add: { graphics: vi.fn(() => gfx) } }
    const sys = new CombatTelegraphRenderSystem(scene as never)
    wireCaster("u1", 100, 200)
    sys.start(baseConePayload())
    sys.update(500) // before startsAt (1000)
    expect(gfx.clear).toHaveBeenCalled()
    expect(gfx.fillStyle).not.toHaveBeenCalled()
    expect(gfx.fillPath).not.toHaveBeenCalled()
  })

  it("draws danger fill when server time is inside the dangerous window", () => {
    const gfx = mockGraphics()
    const scene = { add: { graphics: vi.fn(() => gfx) } }
    const sys = new CombatTelegraphRenderSystem(scene as never)
    wireCaster("u1", 100, 200)
    sys.start(baseConePayload())
    sys.update(2_500)
    expect(gfx.clear).toHaveBeenCalled()
    expect(gfx.fillStyle).toHaveBeenCalledWith(TELEGRAPH_DANGER_FILL_COLOR, TELEGRAPH_DANGER_FILL_ALPHA)
    expect(gfx.fillPath).toHaveBeenCalled()
  })

  it("draws no fill after dangerEnds but before endsAt when that interval exists", () => {
    const gfx = mockGraphics()
    const scene = { add: { graphics: vi.fn(() => gfx) } }
    const sys = new CombatTelegraphRenderSystem(scene as never)
    wireCaster("u1", 100, 200)
    sys.start(
      baseConePayload({
        dangerEndsAtServerTimeMs: 3_000,
        endsAtServerTimeMs: 3_500,
      }),
    )
    sys.update(3_200) // after danger, telegraph still active
    expect(gfx.clear).toHaveBeenCalled()
    expect(gfx.fillPath).not.toHaveBeenCalled()
  })

  it("does not allocate graphics when the scene is in SHUTDOWN (stale Colyseus after teardown)", () => {
    const gfx = mockGraphics()
    const scene = {
      add: { graphics: vi.fn(() => gfx) },
      sys: { settings: { status: SCENE_SHUTDOWN } },
    }
    const sys = new CombatTelegraphRenderSystem(scene as never)
    wireCaster("u1", 100, 200)
    sys.start(baseConePayload())
    expect(scene.add.graphics).not.toHaveBeenCalled()
  })

  it("clears telegraphs on update when scene has shut down", () => {
    const gfx = mockGraphics()
    const scene = {
      add: { graphics: vi.fn(() => gfx) },
      sys: { settings: { status: SCENE_RUNNING } },
    }
    const sys = new CombatTelegraphRenderSystem(scene as never)
    wireCaster("u1", 100, 200)
    sys.start(baseConePayload())
    scene.sys.settings.status = SCENE_SHUTDOWN
    sys.update(2_500)
    expect(gfx.destroy).toHaveBeenCalled()
  })
})
