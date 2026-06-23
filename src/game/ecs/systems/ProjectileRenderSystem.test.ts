import { describe, it, expect, vi, beforeEach } from "vitest"

import { ProjectileRenderSystem } from "./ProjectileRenderSystem"
import { ClientFireball, ClientHomingOrb } from "../components"

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
  const spriteRotationFns: Array<ReturnType<typeof vi.fn>> = []
  const spriteScaleFns: Array<ReturnType<typeof vi.fn>> = []
  const spritePositionFns: Array<ReturnType<typeof vi.fn>> = []
  return {
    spriteDestroyFns,
    emitterDestroyFns,
    emitterStopFns,
    startFollowFns,
    spriteRotationFns,
    spriteScaleFns,
    spritePositionFns,
    scene: {
      add: {
        sprite: vi.fn(() => {
          const destroy = vi.fn()
          const setRotation = vi.fn()
          const setScale = vi.fn()
          const setPosition = vi.fn()
          spriteDestroyFns.push(destroy)
          spriteRotationFns.push(setRotation)
          spriteScaleFns.push(setScale)
          spritePositionFns.push(setPosition)
          return {
            destroy,
            setScale,
            setDepth: vi.fn(),
            play: vi.fn(),
            setRotation,
            setPosition,
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
    for (const k of Object.keys(ClientHomingOrb)) {
      delete ClientHomingOrb[Number(k) as never]
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

  it.each([
    ["east", 100, 0, 0],
    ["west", -100, 0, Math.PI],
    ["south", 0, 100, Math.PI / 2],
    ["north", 0, -100, -Math.PI / 2],
    ["southeast", 100, 100, Math.PI / 4],
  ])("rotates fireball sprites toward %s travel", (_label, vx, vy, expected) => {
    const { scene, spriteRotationFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)

    sys.spawnFireball({ id: 12, ownerId: "u", x: 0, y: 0, vx, vy })

    expect(spriteRotationFns[0]).toHaveBeenCalledWith(expected)
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

  it("buffers fireball batch positions instead of snapping sprites on receipt", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { scene, spritePositionFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.updateServerTimeOffset(1_000)

    sys.spawnFireball({
      id: 43,
      ownerId: "caster",
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    })
    sys.applyBatchUpdate({
      deltas: [{ id: 43, x: 0, y: 0 }],
      removedIds: [],
      seq: 1,
      serverTimeMs: 1_000,
    } as never)
    vi.setSystemTime(1_100)
    sys.applyBatchUpdate({
      deltas: [{ id: 43, x: 100, y: 0 }],
      removedIds: [],
      seq: 2,
      serverTimeMs: 1_100,
    } as never)

    expect(spritePositionFns[0]).not.toHaveBeenCalledWith(100, 0)

    spritePositionFns[0]?.mockClear()
    vi.setSystemTime(1_134)
    sys.update(0)

    expect(spritePositionFns[0]).toHaveBeenCalledWith(50, 0)
    vi.useRealTimers()
  })

  it("buffers legacy fireball batches even if client fireball state is missing", () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)
    const { scene, spritePositionFns, spriteRotationFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)

    sys.spawnFireball({
      id: 44,
      ownerId: "caster",
      x: 0,
      y: 0,
      vx: 100,
      vy: 0,
    })
    delete ClientFireball[44]
    spritePositionFns[0]?.mockClear()
    spriteRotationFns[0]?.mockClear()

    sys.applyBatchUpdate({
      deltas: [{ id: 44, x: 25, y: 35 }],
      removedIds: [],
      seq: 1,
    } as never)

    expect(spritePositionFns[0]).not.toHaveBeenCalled()

    sys.update(0)

    expect(spritePositionFns[0]).toHaveBeenCalledWith(25, 35)
    expect(spriteRotationFns[0]).toHaveBeenCalledWith(0)
    vi.useRealTimers()
  })

  it("does not locally advance fireballs once authoritative buffering begins", () => {
    const { scene } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)

    sys.spawnFireball({
      id: 45,
      ownerId: "caster",
      x: 0,
      y: 0,
      vx: 60,
      vy: 0,
    })
    sys.applyBatchUpdate({
      deltas: [{ id: 45, x: 10, y: 0 }],
      removedIds: [],
      seq: 1,
      serverTimeMs: 1_000,
    } as never)

    sys.update(51)

    expect(ClientFireball[45]?.x).toBe(10)
  })

  it("spawns homing orb sprites at 60% fireball scale and rotates from authoritative heading", () => {
    const { scene, spriteRotationFns, spriteScaleFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)

    sys.spawnHomingOrb({
      id: 90,
      ownerId: "caster",
      targetId: "target",
      x: 10,
      y: 20,
      vx: 120,
      vy: 0,
      headingRad: Math.PI / 4,
      expiresAtServerTimeMs: 15_000,
    })
    sys.applyHomingOrbBatchUpdate({
      deltas: [
        {
          id: 90,
          x: 30,
          y: 40,
          vx: 0,
          vy: 120,
          headingRad: Math.PI / 2,
        },
      ],
      removedIds: [],
      seq: 1,
    })

    expect(scene.add.sprite).toHaveBeenCalledWith(10, 20, "homing-orb")
    expect(spriteScaleFns[0]).toHaveBeenCalledWith(0.12)
    expect(spriteRotationFns[0]).toHaveBeenCalledWith(Math.PI / 4)
    expect(spriteRotationFns[0]).not.toHaveBeenLastCalledWith(Math.PI / 2)
    expect(ClientHomingOrb[90]).toMatchObject({
      x: 30,
      y: 40,
      vx: 0,
      vy: 120,
      headingRad: Math.PI / 2,
      ownerId: "caster",
    })
  })

  it("preserves omitted Homing Orb fields and clears targetId only on null", () => {
    const { scene } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)

    sys.spawnHomingOrb({
      id: 91,
      ownerId: "caster",
      targetId: "target",
      x: 10,
      y: 20,
      vx: 120,
      vy: 0,
      headingRad: 0,
      expiresAtServerTimeMs: 15_000,
    })
    sys.applyHomingOrbBatchUpdate({
      deltas: [{ id: 91, x: 15, y: 25 }],
      removedIds: [],
      seq: 1,
      serverTimeMs: 1_000,
    })

    expect(ClientHomingOrb[91]).toMatchObject({
      x: 15,
      y: 25,
      vx: 120,
      vy: 0,
      headingRad: 0,
      targetId: "target",
    })

    sys.applyHomingOrbBatchUpdate({
      deltas: [{ id: 91, targetId: null }],
      removedIds: [],
      seq: 2,
      serverTimeMs: 1_017,
    })

    expect(ClientHomingOrb[91]?.targetId).toBeUndefined()

    sys.applyHomingOrbBatchUpdate({
      deltas: [{ id: 91, targetId: "new-target" }],
      removedIds: [],
      seq: 3,
      serverTimeMs: 1_034,
    })

    expect(ClientHomingOrb[91]?.targetId).toBe("new-target")
  })

  it("buffers Homing Orb batch positions instead of snapping sprites on receipt", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { scene, spritePositionFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.updateServerTimeOffset(1_000)

    sys.spawnHomingOrb({
      id: 92,
      ownerId: "caster",
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      headingRad: 0,
      expiresAtServerTimeMs: 15_000,
    })
    sys.applyHomingOrbBatchUpdate({
      deltas: [{ id: 92, x: 0, y: 0, vx: 0, vy: 0, headingRad: 0 }],
      removedIds: [],
      seq: 1,
      serverTimeMs: 1_000,
    })
    vi.setSystemTime(1_100)
    sys.applyHomingOrbBatchUpdate({
      deltas: [{ id: 92, x: 100, y: 0, vx: 1_000, vy: 0, headingRad: 0 }],
      removedIds: [],
      seq: 2,
      serverTimeMs: 1_100,
    })

    expect(spritePositionFns[0]).not.toHaveBeenCalledWith(100, 0)

    spritePositionFns[0]?.mockClear()
    vi.setSystemTime(1_134)
    sys.update(0)

    expect(spritePositionFns[0]).toHaveBeenCalledWith(50, 0)
    vi.useRealTimers()
  })

  it("does not locally advance Homing Orbs once authoritative buffering begins", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { scene } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.updateServerTimeOffset(1_000)

    sys.spawnHomingOrb({
      id: 98,
      ownerId: "caster",
      x: 0,
      y: 0,
      vx: 60,
      vy: 0,
      headingRad: 0,
      expiresAtServerTimeMs: 15_000,
    })
    sys.applyHomingOrbBatchUpdate({
      deltas: [{ id: 98, x: 10, y: 0, vx: 60, vy: 0, headingRad: 0 }],
      removedIds: [],
      seq: 1,
      serverTimeMs: 1_000,
    })

    sys.update(51)

    expect(ClientHomingOrb[98]?.x).toBe(10)
    vi.useRealTimers()
  })

  it("applies net timing to Homing Orb interpolation delay", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { scene, spritePositionFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.applyNetTiming({ netSendRateHz: 60 })
    sys.updateServerTimeOffset(1_000)
    sys.spawnHomingOrb({
      id: 93,
      ownerId: "caster",
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      headingRad: 0,
      expiresAtServerTimeMs: 15_000,
    })
    sys.applyHomingOrbBatchUpdate({
      deltas: [{ id: 93, x: 0, y: 0, vx: 0, vy: 0, headingRad: 0 }],
      removedIds: [],
      seq: 1,
      serverTimeMs: 1_000,
    })
    vi.setSystemTime(1_100)
    sys.applyHomingOrbBatchUpdate({
      deltas: [{ id: 93, x: 100, y: 0, vx: 1_000, vy: 0, headingRad: 0 }],
      removedIds: [],
      seq: 2,
      serverTimeMs: 1_100,
    })

    spritePositionFns[0]?.mockClear()
    vi.setSystemTime(1_150)
    sys.update(0)

    expect(spritePositionFns[0]).toHaveBeenCalledWith(100, 0)
    vi.useRealTimers()
  })

  it("advances Homing Orb launch locally until the first server batch arrives", () => {
    const { scene, spritePositionFns, spriteRotationFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnHomingOrb({
      id: 94,
      ownerId: "caster",
      x: 0,
      y: 0,
      vx: 60,
      vy: 0,
      headingRad: Math.PI / 3,
      expiresAtServerTimeMs: 15_000,
    })

    sys.update(17)

    expect(ClientHomingOrb[94]?.x).toBeCloseTo(1, 5)
    const [renderX, renderY] = spritePositionFns[0]!.mock.calls.at(-1)!
    expect(renderX).toBeCloseTo(0.02, 5)
    expect(renderY).toBe(0)
    expect(spriteRotationFns[0]).toHaveBeenLastCalledWith(Math.PI / 3)
  })

  it("full-syncs and removes Homing Orb render buffers", () => {
    const { scene, spriteDestroyFns } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnHomingOrb({
      id: 95,
      ownerId: "caster",
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      headingRad: 0,
      expiresAtServerTimeMs: 15_000,
    })

    sys.applyFullSyncHomingOrbs([
      {
        id: 96,
        ownerId: "caster",
        x: 10,
        y: 20,
        vx: 30,
        vy: 40,
        headingRad: 0.25,
        expiresAtServerTimeMs: 15_000,
      },
    ], 1_000)
    sys.applyHomingOrbBatchUpdate({ deltas: [], removedIds: [96, 999], seq: 1 })

    expect(spriteDestroyFns[0]).toHaveBeenCalledTimes(1)
    expect(spriteDestroyFns[1]).toHaveBeenCalledTimes(1)
    expect(ClientHomingOrb[95]).toBeUndefined()
    expect(ClientHomingOrb[96]).toBeUndefined()
  })

  it("skips Homing Orb render updates if client state is missing", () => {
    const { scene } = mockScene()
    const sys = new ProjectileRenderSystem(scene as never)
    sys.spawnHomingOrb({
      id: 97,
      ownerId: "caster",
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      headingRad: 0,
      expiresAtServerTimeMs: 15_000,
    })
    delete ClientHomingOrb[97]

    expect(() => sys.update(17)).not.toThrow()
  })
})
