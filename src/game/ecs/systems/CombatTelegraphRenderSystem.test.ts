import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  TELEGRAPH_DANGER_FILL_ALPHA,
  TELEGRAPH_DANGER_FILL_COLOR,
  TELEGRAPH_WINDUP_FILL_ALPHA,
  TELEGRAPH_WINDUP_FILL_COLOR,
} from "@/shared/balance-config"
import type { CombatTelegraphStartPayload } from "@/shared/types"
import { ClientPlayerState, ClientRenderPos } from "../components"
import { CombatTelegraphRenderSystem } from "./CombatTelegraphRenderSystem"

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
})
