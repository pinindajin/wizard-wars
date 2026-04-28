import { describe, it, expect, vi, beforeEach } from "vitest"

import { PrimaryMeleeAttackRenderSystem } from "./PrimaryMeleeAttackRenderSystem"

function basePayload() {
  return {
    casterId: "u1",
    attackId: "red_wizard_cleaver" as const,
    x: 100,
    y: 200,
    facingAngle: 0,
    damage: 25,
    hurtboxRadiusPx: 45,
    hurtboxArcDeg: 180,
    durationMs: 200,
    dangerousWindowStartMs: 60,
    dangerousWindowEndMs: 140,
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
    lineStyle: vi.fn(),
    strokePath: vi.fn(),
  }
}

function mockScene(texturesExists: boolean) {
  const graphics = mockGraphics()
  return {
    graphics,
    scene: {
      add: {
        graphics: vi.fn(() => graphics),
        sprite: vi.fn(() => ({
          destroy: vi.fn(),
          setDepth: vi.fn(),
          setRotation: vi.fn(),
          setAlpha: vi.fn(),
          setPosition: vi.fn(),
        })),
      },
      textures: { exists: vi.fn(() => texturesExists) },
    },
  }
}

describe("PrimaryMeleeAttackRenderSystem", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("spawnSwing adds graphics and optionally a sprite when axe texture exists", () => {
    const { scene, graphics } = mockScene(true)
    const sys = new PrimaryMeleeAttackRenderSystem(scene as never)
    sys.spawnSwing(basePayload())
    expect(scene.add.graphics).toHaveBeenCalledTimes(1)
    expect(scene.add.sprite).toHaveBeenCalledTimes(1)
    expect(graphics.setDepth).toHaveBeenCalled()
  })

  it("spawnSwing skips sprite when axe texture is missing", () => {
    const { scene } = mockScene(false)
    const sys = new PrimaryMeleeAttackRenderSystem(scene as never)
    sys.spawnSwing(basePayload())
    expect(scene.add.sprite).not.toHaveBeenCalled()
  })

  it("update destroys swing after duration and stops redrawing", () => {
    const { scene, graphics } = mockScene(false)
    const sys = new PrimaryMeleeAttackRenderSystem(scene as never)
    sys.spawnSwing({ ...basePayload(), durationMs: 100 })
    sys.update(50)
    expect(graphics.clear).toHaveBeenCalled()
    sys.update(60)
    expect(graphics.destroy).toHaveBeenCalledTimes(1)
    graphics.clear.mockClear()
    sys.update(10)
    expect(graphics.clear).not.toHaveBeenCalled()
  })

  it("destroy tears down all active swings", () => {
    const { scene, graphics } = mockScene(false)
    const sys = new PrimaryMeleeAttackRenderSystem(scene as never)
    sys.spawnSwing(basePayload())
    sys.destroy()
    expect(graphics.destroy).toHaveBeenCalledTimes(1)
  })

  it("updates axe sprite alpha and orbit when texture exists", () => {
    const sprite = {
      destroy: vi.fn(),
      setDepth: vi.fn(),
      setRotation: vi.fn(),
      setAlpha: vi.fn(),
      setPosition: vi.fn(),
    }
    const graphics = mockGraphics()
    const scene = {
      add: {
        graphics: vi.fn(() => graphics),
        sprite: vi.fn(() => sprite),
      },
      textures: { exists: vi.fn(() => true) },
    }
    const sys = new PrimaryMeleeAttackRenderSystem(scene as never)
    sys.spawnSwing(basePayload())
    sys.update(50)
    expect(sprite.setAlpha).toHaveBeenCalled()
    expect(sprite.setPosition).toHaveBeenCalled()
    expect(sprite.setRotation).toHaveBeenCalled()
  })

  it("destroys sprite on expiry when texture exists", () => {
    const sprite = {
      destroy: vi.fn(),
      setDepth: vi.fn(),
      setRotation: vi.fn(),
      setAlpha: vi.fn(),
      setPosition: vi.fn(),
    }
    const graphics = mockGraphics()
    const scene = {
      add: {
        graphics: vi.fn(() => graphics),
        sprite: vi.fn(() => sprite),
      },
      textures: { exists: vi.fn(() => true) },
    }
    const sys = new PrimaryMeleeAttackRenderSystem(scene as never)
    sys.spawnSwing({ ...basePayload(), durationMs: 80 })
    sys.update(100)
    expect(sprite.destroy).toHaveBeenCalledTimes(1)
  })

  it("destroy() tears down sprite when present", () => {
    const sprite = {
      destroy: vi.fn(),
      setDepth: vi.fn(),
      setRotation: vi.fn(),
      setAlpha: vi.fn(),
      setPosition: vi.fn(),
    }
    const graphics = mockGraphics()
    const scene = {
      add: {
        graphics: vi.fn(() => graphics),
        sprite: vi.fn(() => sprite),
      },
      textures: { exists: vi.fn(() => true) },
    }
    const sys = new PrimaryMeleeAttackRenderSystem(scene as never)
    sys.spawnSwing(basePayload())
    sys.destroy()
    expect(sprite.destroy).toHaveBeenCalledTimes(1)
  })
})
