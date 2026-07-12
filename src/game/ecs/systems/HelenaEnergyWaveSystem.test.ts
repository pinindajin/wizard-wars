import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PrimaryMeleeAttackPayload } from "@/shared/types"
import { HelenaEnergyWaveSystem } from "./HelenaEnergyWaveSystem"
import { helenaEnergyWaveSpec } from "./helenaEnergyWave"

vi.mock("phaser", () => ({
  default: {
    Scenes: { SHUTDOWN: 6, DESTROYED: 7 },
  },
}))

function payload(overrides: Partial<PrimaryMeleeAttackPayload> = {}): PrimaryMeleeAttackPayload {
  return {
    casterId: "helena-player",
    attackId: "helena_energy_wave",
    x: 100,
    y: 200,
    facingAngle: 0,
    damage: 10,
    hurtboxRadiusPx: 67.5,
    hurtboxArcDeg: 75.6,
    durationMs: 570,
    dangerousWindowStartMs: 300,
    dangerousWindowEndMs: 570,
    ...overrides,
  }
}

describe("helenaEnergyWaveSpec", () => {
  it("turns Helena's authoritative melee payload into one cosmetic wave", () => {
    expect(helenaEnergyWaveSpec(payload())).toEqual({
      delayMs: 300,
      durationMs: 270,
      startX: 100,
      startY: 200,
      endX: 167.5,
      endY: 200,
      rotation: 0,
    })
  })

  it("rotates travel with the locked melee facing and ignores other attacks", () => {
    const north = helenaEnergyWaveSpec(payload({ facingAngle: -Math.PI / 2 }))
    expect(north?.endX).toBeCloseTo(100)
    expect(north?.endY).toBeCloseTo(132.5)
    expect(helenaEnergyWaveSpec(payload({ attackId: "triss_big_blast" }))).toBeNull()
  })
})

describe("HelenaEnergyWaveSystem", () => {
  const timer = { remove: vi.fn() }
  const sprite = {
    setOrigin: vi.fn(),
    setRotation: vi.fn(),
    setDepth: vi.fn(),
    play: vi.fn(),
    destroy: vi.fn(),
  }
  const scene = {
    sys: { settings: { status: 1 } },
    anims: {
      exists: vi.fn(() => false),
      generateFrameNumbers: vi.fn(() => [{ key: "wave", frame: 0 }]),
      create: vi.fn(),
    },
    time: { delayedCall: vi.fn() },
    add: { sprite: vi.fn() },
    tweens: { add: vi.fn() },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    scene.sys.settings.status = 1
    sprite.setOrigin.mockReturnValue(sprite)
    sprite.setRotation.mockReturnValue(sprite)
    sprite.setDepth.mockReturnValue(sprite)
    scene.add.sprite.mockReturnValue(sprite)
    scene.time.delayedCall.mockReturnValue(timer)
  })

  it("delays, rotates, travels, fades, and destroys one Helena wave", () => {
    const system = new HelenaEnergyWaveSystem(scene as never)

    system.spawn(payload({ facingAngle: Math.PI / 2 }))

    expect(scene.time.delayedCall).toHaveBeenCalledWith(300, expect.any(Function))
    const delayed = scene.time.delayedCall.mock.calls[0]![1]
    delayed()
    expect(scene.add.sprite).toHaveBeenCalledWith(100, 200, "helena-energy-wave")
    expect(sprite.setRotation).toHaveBeenCalledWith(Math.PI / 2)
    expect(sprite.play).toHaveBeenCalledWith("helena-energy-wave-pulse")
    expect(scene.tweens.add).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: sprite,
        x: expect.closeTo(100),
        y: 267.5,
        alpha: 0,
        duration: 270,
      }),
    )
    const tween = scene.tweens.add.mock.calls[0]![0]
    tween.onComplete()
    expect(sprite.destroy).toHaveBeenCalledOnce()
  })

  it("cancels delayed work and destroys active sprites during teardown", () => {
    const system = new HelenaEnergyWaveSystem(scene as never)
    system.spawn(payload())
    const delayed = scene.time.delayedCall.mock.calls[0]![1]
    delayed()

    system.destroy()

    expect(sprite.destroy).toHaveBeenCalledOnce()

    system.spawn(payload())
    system.destroy()
    expect(timer.remove).toHaveBeenCalledWith(false)
  })

  it("does not create objects after the scene shuts down", () => {
    const system = new HelenaEnergyWaveSystem(scene as never)
    system.spawn(payload())
    const delayed = scene.time.delayedCall.mock.calls[0]![1]
    scene.sys.settings.status = 6

    delayed()

    expect(scene.add.sprite).not.toHaveBeenCalled()
  })
})
