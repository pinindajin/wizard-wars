import { describe, it, expect, vi, beforeEach } from "vitest"

import { ProjectileRenderSystem } from "./ProjectileRenderSystem"
import { ClientFireball } from "../components"

function mockScene() {
  const destroyFns: Array<ReturnType<typeof vi.fn>> = []
  return {
    destroyFns,
    scene: {
      add: {
        sprite: vi.fn(() => {
          const destroy = vi.fn()
          destroyFns.push(destroy)
          return {
            destroy,
            setScale: vi.fn(),
            setDepth: vi.fn(),
            play: vi.fn(),
            setRotation: vi.fn(),
            setPosition: vi.fn(),
          }
        }),
      },
      anims: { exists: vi.fn(() => false) },
    },
  }
}

describe("ProjectileRenderSystem", () => {
  beforeEach(() => {
    for (const k of Object.keys(ClientFireball)) {
      delete ClientFireball[Number(k) as never]
    }
  })

  it("spawnFireball is idempotent for the same id", () => {
    const { scene, destroyFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    const payload = {
      id: 7,
      ownerId: "u1",
      x: 10,
      y: 20,
      vx: 100,
      vy: 0,
    }
    sys.spawnFireball(payload)
    sys.spawnFireball({ ...payload, x: 99, y: 88 })
    expect(destroyFns.length).toBe(2)
    expect(destroyFns[0]).toHaveBeenCalledTimes(1)
    expect(ClientFireball[7]).toMatchObject({ x: 99, y: 88, ownerId: "u1" })
  })

  it("applyFullSyncFireballs replaces all fireballs", () => {
    const { scene, destroyFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnFireball({
      id: 1,
      ownerId: "a",
      x: 0,
      y: 0,
      vx: 1,
      vy: 0,
    })
    sys.applyFullSyncFireballs([
      { id: 2, ownerId: "b", x: 5, y: 6, vx: 0, vy: 1 },
    ])
    expect(ClientFireball[1]).toBeUndefined()
    expect(ClientFireball[2]).toBeDefined()
    expect(destroyFns[0]).toHaveBeenCalled()
  })

  it("advances positions by velocity * TICK_DT_SEC per committed sim step, not per render frame", () => {
    // Regression for the projectile cause-B pattern: under variable
    // delta integration a fireball's client-side position diverged
    // from the server within any frame where delta != 1/60 s. With
    // the fixed-step refactor, 3 × TICK_MS of real time must advance
    // the committed simCurr by exactly 3 × (vx × TICK_DT_SEC) —
    // matching the server's own integration math.
    const { scene } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnFireball({
      id: 42,
      ownerId: "caster",
      x: 0,
      y: 0,
      vx: 600,
      vy: 0,
    })

    // 51 ms slightly above 3 × TICK_MS = 50 so float precision at the
    // accumulator boundary cannot eat a step.
    sys.update(51)

    // After exactly 3 committed sim steps at vx=600, TICK_DT_SEC=1/60,
    // simCurr advances by 600 × (1/60) × 3 = 30 px.
    expect(ClientFireball[42]?.x).toBeCloseTo(30, 5)
  })
})
