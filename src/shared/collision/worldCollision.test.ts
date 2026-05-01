import { describe, expect, it } from "vitest"

import {
  canOccupyWorldPosition,
  moveWithinWorld,
  resolveAgainstWorld,
  resolveJumpLandingWithGrace,
  type ArenaPropColliderRect,
} from "./worldCollision"

const fixtureBounds = { width: 300, height: 300 }
const fixtureFootprint = { radiusX: 20, radiusY: 12, offsetY: 10 }
const fixtureTopClearance = fixtureFootprint.radiusY - fixtureFootprint.offsetY
const fixtureBottomClearance = fixtureFootprint.radiusY + fixtureFootprint.offsetY
const fixtureBlocker: ArenaPropColliderRect = {
  x: 100,
  y: 100,
  width: 80,
  height: 80,
}

describe("canOccupyWorldPosition", () => {
  it("accepts free positions and exact oval-to-rect touches", () => {
    expect(
      canOccupyWorldPosition(
        60,
        140,
        fixtureFootprint,
        fixtureBounds,
        [fixtureBlocker],
      ),
    ).toBe(true)
    expect(
      canOccupyWorldPosition(
        fixtureBlocker.x - 20,
        140,
        fixtureFootprint,
        fixtureBounds,
        [fixtureBlocker],
      ),
    ).toBe(true)
  })

  it("rejects overlapping and out-of-bounds positions", () => {
    expect(
      canOccupyWorldPosition(
        fixtureBlocker.x - 19,
        140,
        fixtureFootprint,
        fixtureBounds,
        [fixtureBlocker],
      ),
    ).toBe(false)
    expect(canOccupyWorldPosition(19, 140, fixtureFootprint, fixtureBounds, [])).toBe(false)
    expect(canOccupyWorldPosition(281, 140, fixtureFootprint, fixtureBounds, [])).toBe(false)
    expect(canOccupyWorldPosition(140, 1, fixtureFootprint, fixtureBounds, [])).toBe(false)
    expect(canOccupyWorldPosition(140, 279, fixtureFootprint, fixtureBounds, [])).toBe(false)
  })
})

describe("resolveJumpLandingWithGrace", () => {
  const lava: ArenaPropColliderRect = { x: 100, y: 100, width: 64, height: 100 }

  it("accepts an already legal landing point", () => {
    expect(
      resolveJumpLandingWithGrace(
        lava.x + lava.width + fixtureFootprint.radiusX,
        140,
        fixtureFootprint,
        fixtureBounds,
        [lava],
        { movementX: 1, movementY: 0, gracePx: 6 },
      ),
    ).toEqual({ x: lava.x + lava.width + fixtureFootprint.radiusX, y: 140 })
  })

  it("nudges a tiny edge overlap along the landing movement direction", () => {
    const out = resolveJumpLandingWithGrace(
      lava.x + lava.width + fixtureFootprint.radiusX - 4,
      140,
      fixtureFootprint,
      fixtureBounds,
      [lava],
      { movementX: 1, movementY: 0, gracePx: 6 },
    )

    expect(out).toEqual({ x: lava.x + lava.width + fixtureFootprint.radiusX, y: 140 })
  })

  it("rejects a deep landing inside blocked terrain", () => {
    expect(
      resolveJumpLandingWithGrace(
        lava.x + lava.width / 2,
        140,
        fixtureFootprint,
        fixtureBounds,
        [lava],
        { movementX: 1, movementY: 0, gracePx: 6 },
      ),
    ).toBeNull()
  })
})

describe("moveWithinWorld", () => {
  it("applies a full step when the candidate position stays legal", () => {
    const out = moveWithinWorld(40, 40, 10, 5, fixtureFootprint, fixtureBounds, [fixtureBlocker])

    expect(out).toEqual({
      x: 50,
      y: 45,
      appliedDx: 10,
      appliedDy: 5,
      blockedX: false,
      blockedY: false,
    })
  })

  it("blocks horizontal entry into a collider", () => {
    const out = moveWithinWorld(
      fixtureBlocker.x - 20,
      140,
      5,
      0,
      fixtureFootprint,
      fixtureBounds,
      [fixtureBlocker],
    )

    expect(out).toEqual({
      x: fixtureBlocker.x - 20,
      y: 140,
      appliedDx: 0,
      appliedDy: 0,
      blockedX: true,
      blockedY: false,
    })
  })

  it("blocks vertical entry into a collider", () => {
    const out = moveWithinWorld(
      140,
      fixtureBlocker.y - fixtureBottomClearance,
      0,
      5,
      fixtureFootprint,
      fixtureBounds,
      [fixtureBlocker],
    )

    expect(out).toEqual({
      x: 140,
      y: fixtureBlocker.y - fixtureBottomClearance,
      appliedDx: 0,
      appliedDy: 0,
      blockedX: false,
      blockedY: true,
    })
  })

  it("slides along the open axis when diagonal movement hits a wall", () => {
    const out = moveWithinWorld(
      fixtureBlocker.x - 20,
      120,
      5,
      10,
      fixtureFootprint,
      fixtureBounds,
      [fixtureBlocker],
    )

    expect(out).toEqual({
      x: fixtureBlocker.x - 20,
      y: 130,
      appliedDx: 0,
      appliedDy: 10,
      blockedX: true,
      blockedY: false,
    })
  })

  it("uses X before Y for equal diagonal corner ties", () => {
    const cornerBlocker: ArenaPropColliderRect = {
      x: 100,
      y: 100,
      width: 80,
      height: 80,
    }
    const out = moveWithinWorld(
      75,
      75,
      10,
      10,
      fixtureFootprint,
      fixtureBounds,
      [cornerBlocker],
    )

    expect(out.appliedDx).toBe(10)
    expect(out.appliedDy).toBe(0)
    expect(out.blockedX).toBe(false)
    expect(out.blockedY).toBe(true)
  })

  it("blocks steps that would leave arena bounds", () => {
    const out = moveWithinWorld(20, 80, -5, 0, fixtureFootprint, fixtureBounds, [])

    expect(out).toEqual({
      x: 20,
      y: 80,
      appliedDx: 0,
      appliedDy: 0,
      blockedX: true,
      blockedY: false,
    })
  })
})

describe("resolveAgainstWorld", () => {
  const bounds = { width: 1000, height: 800 }

  it("is a no-op when fully inside and not overlapping any prop", () => {
    const out = resolveAgainstWorld(500, 400, fixtureFootprint, bounds, [])
    expect(out).toEqual({ x: 500, y: 400 })
  })

  it("clamps against the left bound using the oval horizontal radius", () => {
    const out = resolveAgainstWorld(5, 400, fixtureFootprint, bounds, [])
    expect(out.x).toBe(20)
    expect(out.y).toBe(400)
  })

  it("clamps against the right bound using the oval horizontal radius", () => {
    const out = resolveAgainstWorld(9999, 400, fixtureFootprint, bounds, [])
    expect(out.x).toBe(bounds.width - 20)
  })

  it("clamps against the top and bottom bounds", () => {
    const top = resolveAgainstWorld(500, -50, fixtureFootprint, bounds, [])
    expect(top.y).toBe(fixtureTopClearance)

    const bot = resolveAgainstWorld(500, 5000, fixtureFootprint, bounds, [])
    expect(bot.y).toBe(bounds.height - fixtureBottomClearance)
  })

  it("resolves an oval overlapping a prop collider along an edge", () => {
    const prop: ArenaPropColliderRect = { x: 100, y: 100, width: 100, height: 100 }
    const out = resolveAgainstWorld(150, 90, fixtureFootprint, bounds, [prop])
    expect(out.y).toBeLessThanOrEqual(prop.y - fixtureBottomClearance + 1e-6)
  })

  it("pushes an oval out when its center starts inside a collider", () => {
    const lava: ArenaPropColliderRect = { x: 100, y: 100, width: 100, height: 100 }
    const out = resolveAgainstWorld(150, 150, fixtureFootprint, bounds, [lava])

    const outsideX =
      out.x <= lava.x - fixtureFootprint.radiusX ||
      out.x >= lava.x + lava.width + fixtureFootprint.radiusX
    const outsideY =
      out.y <= lava.y - fixtureBottomClearance ||
      out.y >= lava.y + lava.height + fixtureTopClearance
    expect(outsideX || outsideY).toBe(true)
  })

  it("pushes an embedded oval out through the nearest edge", () => {
    const lava: ArenaPropColliderRect = { x: 100, y: 100, width: 100, height: 100 }

    expect(resolveAgainstWorld(195, 150, fixtureFootprint, bounds, [lava]).x).toBeGreaterThanOrEqual(
      lava.x + lava.width + fixtureFootprint.radiusX,
    )
    expect(resolveAgainstWorld(150, 105, fixtureFootprint, bounds, [lava]).y).toBeLessThanOrEqual(
      lava.y - fixtureBottomClearance,
    )
    expect(resolveAgainstWorld(150, 195, fixtureFootprint, bounds, [lava]).y).toBeGreaterThanOrEqual(
      lava.y + lava.height + fixtureTopClearance,
    )
  })

  it("keeps emergency recovery clamped when a blocker overlaps a world edge", () => {
    expect(
      resolveAgainstWorld(20, 50, fixtureFootprint, { width: 100, height: 100 }, [
        { x: 20, y: 40, width: 20, height: 20 },
      ]).x,
    ).toBe(20)
    expect(
      resolveAgainstWorld(80, 50, fixtureFootprint, { width: 100, height: 100 }, [
        { x: 60, y: 40, width: 20, height: 20 },
      ]).x,
    ).toBe(80)
    expect(
      resolveAgainstWorld(50, fixtureTopClearance, fixtureFootprint, { width: 100, height: 100 }, [
        { x: 40, y: 20, width: 20, height: 20 },
      ]).y,
    ).toBe(fixtureTopClearance)
    expect(
      resolveAgainstWorld(50, 100 - fixtureBottomClearance, fixtureFootprint, { width: 100, height: 100 }, [
        { x: 40, y: 60, width: 20, height: 20 },
      ]).y,
    ).toBe(100 - fixtureBottomClearance)
  })

  it("resolves against adjacent partial transition strips", () => {
    const northStrip: ArenaPropColliderRect = { x: 100, y: 100, width: 64, height: 13 }
    const westStrip: ArenaPropColliderRect = { x: 100, y: 100, width: 13, height: 64 }

    const out = resolveAgainstWorld(120, 120, fixtureFootprint, bounds, [northStrip, westStrip])

    expect(out.x).toBeGreaterThanOrEqual(westStrip.x + westStrip.width + fixtureFootprint.radiusX)
    expect(out.y).toBeGreaterThanOrEqual(northStrip.y + northStrip.height + fixtureTopClearance)
  })

  it("does not move an oval fully outside a prop", () => {
    const prop: ArenaPropColliderRect = { x: 100, y: 100, width: 100, height: 100 }
    const out = resolveAgainstWorld(500, 500, fixtureFootprint, bounds, [prop])
    expect(out).toEqual({ x: 500, y: 500 })
  })
})
