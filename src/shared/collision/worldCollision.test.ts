import { describe, expect, it } from "vitest"

import { resolveAgainstWorld, type ArenaPropColliderRect } from "./worldCollision"

describe("resolveAgainstWorld", () => {
  const bounds = { width: 1000, height: 800 }

  it("is a no-op when fully inside and not overlapping any prop", () => {
    const out = resolveAgainstWorld(500, 400, 20, bounds, [])
    expect(out).toEqual({ x: 500, y: 400 })
  })

  it("clamps against the left bound using the circle radius", () => {
    const out = resolveAgainstWorld(5, 400, 20, bounds, [])
    expect(out.x).toBe(20)
    expect(out.y).toBe(400)
  })

  it("clamps against the right bound using the circle radius", () => {
    const out = resolveAgainstWorld(9999, 400, 20, bounds, [])
    expect(out.x).toBe(bounds.width - 20)
  })

  it("clamps against the top and bottom bounds", () => {
    const top = resolveAgainstWorld(500, -50, 20, bounds, [])
    expect(top.y).toBe(20)

    const bot = resolveAgainstWorld(500, 5000, 20, bounds, [])
    expect(bot.y).toBe(bounds.height - 20)
  })

  it("resolves a circle overlapping a prop collider along an edge", () => {
    const prop: ArenaPropColliderRect = { x: 100, y: 100, width: 100, height: 100 }
    // Circle center just inside the top edge → pushed upward by MTV.
    const out = resolveAgainstWorld(150, 90, 20, bounds, [prop])
    expect(out.y).toBeLessThanOrEqual(prop.y - 20 + 1e-6)
  })

  it("pushes a circle out when its center starts inside a collider", () => {
    const lava: ArenaPropColliderRect = { x: 100, y: 100, width: 100, height: 100 }
    const out = resolveAgainstWorld(150, 150, 20, bounds, [lava])

    const outsideX = out.x <= lava.x - 20 || out.x >= lava.x + lava.width + 20
    const outsideY = out.y <= lava.y - 20 || out.y >= lava.y + lava.height + 20
    expect(outsideX || outsideY).toBe(true)
  })

  it("resolves against adjacent partial transition strips", () => {
    const northStrip: ArenaPropColliderRect = { x: 100, y: 100, width: 64, height: 13 }
    const westStrip: ArenaPropColliderRect = { x: 100, y: 100, width: 13, height: 64 }

    const out = resolveAgainstWorld(120, 120, 20, bounds, [northStrip, westStrip])

    expect(out.x).toBeGreaterThanOrEqual(westStrip.x + westStrip.width + 20)
    expect(out.y).toBeGreaterThanOrEqual(northStrip.y + northStrip.height + 20)
  })

  it("does not move a circle fully outside a prop", () => {
    const prop: ArenaPropColliderRect = { x: 100, y: 100, width: 100, height: 100 }
    const out = resolveAgainstWorld(500, 500, 20, bounds, [prop])
    expect(out).toEqual({ x: 500, y: 500 })
  })
})
