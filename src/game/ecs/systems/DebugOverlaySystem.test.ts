import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("phaser", () => ({ default: {} }))

import {
  DebugOverlaySystem,
  fireballPreviewLineFor,
} from "./DebugOverlaySystem"
import { ClientPlayerState, ClientRenderPos } from "../components"
import { addEntity, clientEntities, removeEntity } from "../world"

function clearClientWorld() {
  for (const id of [...clientEntities]) {
    removeEntity(id)
    delete ClientRenderPos[id]
    delete ClientPlayerState[id]
  }
}

function mockScene() {
  const graphics = {
    clear: vi.fn(),
    destroy: vi.fn(),
    fillCircle: vi.fn(),
    fillStyle: vi.fn(),
    lineBetween: vi.fn(),
    lineStyle: vi.fn(),
    setDepth: vi.fn(),
    setVisible: vi.fn(),
    strokeCircle: vi.fn(),
    strokeEllipse: vi.fn(),
    strokeRect: vi.fn(),
  }
  return {
    graphics,
    scene: {
      add: { graphics: vi.fn(() => graphics) },
      events: { once: vi.fn() },
    },
  }
}

function addPlayer(
  id: number,
  overrides: Partial<(typeof ClientPlayerState)[number]> = {},
) {
  addEntity(id)
  ClientRenderPos[id] = { x: 100, y: 200 }
  ClientPlayerState[id] = {
    playerId: `p${id}`,
    username: `P${id}`,
    heroId: "red_wizard",
    health: 100,
    maxHealth: 100,
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
    ...overrides,
  }
}

describe("DebugOverlaySystem", () => {
  beforeEach(() => {
    clearClientWorld()
  })

  it("computes fireball preview line from spawn offset and 200 px length", () => {
    expect(fireballPreviewLineFor(100, 100, 0)).toEqual({
      x1: 125,
      y1: 100,
      x2: 325,
      y2: 100,
    })
  })

  it("does no per-player draw work while disabled", () => {
    addPlayer(1)
    const { scene, graphics } = mockScene()
    const system = new DebugOverlaySystem(scene as never)

    system.update()

    expect(graphics.strokeRect).not.toHaveBeenCalled()
    expect(graphics.strokeEllipse).not.toHaveBeenCalled()
    expect(graphics.strokeCircle).not.toHaveBeenCalled()
  })

  it("draws hitbox, collision footprint, center, and fireball preview when enabled", () => {
    addPlayer(1, { animState: "light_cast", castingAbilityId: "fireball" })
    const { scene, graphics } = mockScene()
    const system = new DebugOverlaySystem(scene as never)

    system.setEnabled(true)
    system.update()

    expect(graphics.strokeRect).toHaveBeenCalledWith(85, 160, 30, 55)
    expect(graphics.strokeEllipse).toHaveBeenCalledWith(100, 208, 40, 18)
    expect(graphics.strokeCircle).toHaveBeenCalledWith(100, 200, 4)
    expect(graphics.lineBetween).toHaveBeenCalledWith(125, 200, 325, 200)
  })
})
