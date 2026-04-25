import { describe, it, expect, vi, beforeEach } from "vitest"

import { ProjectileRenderSystem } from "./ProjectileRenderSystem"
import { ClientFireball } from "../components"

/**
 * Builds a Phaser-shaped scene mock with both `add.sprite` and
 * `add.particles` plus a `textures.exists` shim, so `ProjectileRenderSystem`
 * can exercise the full sprite + emitter lifecycle in unit tests.
 */
function mockScene() {
  const spriteDestroyFns: Array<ReturnType<typeof vi.fn>> = []
  const emitterDestroyFns: Array<ReturnType<typeof vi.fn>> = []
  const emitterStopFns: Array<ReturnType<typeof vi.fn>> = []
  const startFollowFns: Array<ReturnType<typeof vi.fn>> = []
  return {
    spriteDestroyFns,
    emitterDestroyFns,
    emitterStopFns,
    startFollowFns,
    scene: {
      add: {
        sprite: vi.fn(() => {
          const destroy = vi.fn()
          spriteDestroyFns.push(destroy)
          return {
            destroy,
            setScale: vi.fn(),
            setDepth: vi.fn(),
            play: vi.fn(),
            setRotation: vi.fn(),
            setPosition: vi.fn(),
          }
        }),
        particles: vi.fn(() => {
          const destroy = vi.fn()
          const stop = vi.fn()
          const startFollow = vi.fn()
          emitterDestroyFns.push(destroy)
          emitterStopFns.push(stop)
          startFollowFns.push(startFollow)
          return { destroy, stop, startFollow, setDepth: vi.fn() }
        }),
      },
      anims: { exists: vi.fn(() => false) },
      textures: { exists: vi.fn(() => true) },
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
    const { scene, spriteDestroyFns } = mockScene()
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
    expect(spriteDestroyFns.length).toBe(2)
    expect(spriteDestroyFns[0]).toHaveBeenCalledTimes(1)
    expect(ClientFireball[7]).toMatchObject({ x: 99, y: 88, ownerId: "u1" })
  })

  it("applyFullSyncFireballs replaces all fireballs", () => {
    const { scene, spriteDestroyFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnFireball({ id: 1, ownerId: "a", x: 0, y: 0, vx: 1, vy: 0 })
    sys.applyFullSyncFireballs([
      { id: 2, ownerId: "b", x: 5, y: 6, vx: 0, vy: 1 },
    ])
    expect(ClientFireball[1]).toBeUndefined()
    expect(ClientFireball[2]).toBeDefined()
    expect(spriteDestroyFns[0]).toHaveBeenCalled()
  })

  it("attaches an ember emitter via startFollow on spawn", () => {
    const { scene, startFollowFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnFireball({ id: 3, ownerId: "u", x: 0, y: 0, vx: 1, vy: 0 })
    expect(scene.add.particles).toHaveBeenCalledTimes(1)
    expect(startFollowFns[0]).toHaveBeenCalledTimes(1)
  })

  it("creates the ember emitter at world origin so startFollow coords are not double-translated", () => {
    const { scene } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnFireball({
      id: 11,
      ownerId: "u",
      x: 400,
      y: 500,
      vx: 1,
      vy: 0,
    })
    expect(scene.add.particles).toHaveBeenCalledWith(
      0,
      0,
      "ember",
      expect.any(Object),
    )
    expect(scene.add.sprite).toHaveBeenCalledWith(
      400,
      500,
      expect.any(String),
    )
  })

  it("stops and destroys the emitter on destroyFireball", () => {
    const { scene, emitterStopFns, emitterDestroyFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnFireball({ id: 4, ownerId: "u", x: 0, y: 0, vx: 1, vy: 0 })
    sys.destroyFireball(4)
    expect(emitterStopFns[0]).toHaveBeenCalledTimes(1)
    expect(emitterDestroyFns[0]).toHaveBeenCalledTimes(1)
  })

  it("applyBatchUpdate.removedIds tears down both sprite and emitter", () => {
    const { scene, emitterDestroyFns, spriteDestroyFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnFireball({ id: 5, ownerId: "u", x: 0, y: 0, vx: 1, vy: 0 })
    sys.applyBatchUpdate({ deltas: [], removedIds: [5], seq: 0 })
    expect(emitterDestroyFns[0]).toHaveBeenCalledTimes(1)
    expect(spriteDestroyFns[0]).toHaveBeenCalledTimes(1)
  })

  it("applyFullSyncFireballs([]) cleans up all emitters", () => {
    const { scene, emitterDestroyFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnFireball({ id: 6, ownerId: "u", x: 0, y: 0, vx: 1, vy: 0 })
    sys.spawnFireball({ id: 7, ownerId: "u", x: 0, y: 0, vx: 1, vy: 0 })
    sys.applyFullSyncFireballs([])
    expect(emitterDestroyFns[0]).toHaveBeenCalledTimes(1)
    expect(emitterDestroyFns[1]).toHaveBeenCalledTimes(1)
  })

  it("destroy() tears down all sprites and emitters", () => {
    const { scene, emitterDestroyFns, spriteDestroyFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnFireball({ id: 8, ownerId: "u", x: 0, y: 0, vx: 1, vy: 0 })
    sys.spawnFireball({ id: 9, ownerId: "u", x: 0, y: 0, vx: 1, vy: 0 })
    sys.destroy()
    expect(emitterDestroyFns[0]).toHaveBeenCalledTimes(1)
    expect(emitterDestroyFns[1]).toHaveBeenCalledTimes(1)
    expect(spriteDestroyFns[0]).toHaveBeenCalledTimes(1)
    expect(spriteDestroyFns[1]).toHaveBeenCalledTimes(1)
  })

  it("works without particles support (skips emitter creation cleanly)", () => {
    const sceneWithoutParticles = {
      add: {
        sprite: vi.fn(() => ({
          destroy: vi.fn(),
          setScale: vi.fn(),
          setDepth: vi.fn(),
          play: vi.fn(),
          setRotation: vi.fn(),
          setPosition: vi.fn(),
        })),
      },
      anims: { exists: vi.fn(() => false) },
    }
    const sys = new ProjectileRenderSystem(sceneWithoutParticles as never)
    expect(() =>
      sys.spawnFireball({ id: 10, ownerId: "u", x: 0, y: 0, vx: 1, vy: 0 }),
    ).not.toThrow()
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
