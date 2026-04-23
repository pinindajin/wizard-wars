import { describe, expect, it } from "vitest"

import { RemoteInterpolationBuffer } from "./RemoteInterpolationBuffer"
import { REMOTE_EXTRAPOLATION_CAP_MS } from "@/shared/balance-config/rendering"

describe("RemoteInterpolationBuffer", () => {
  it("returns null when nothing is buffered", () => {
    const b = new RemoteInterpolationBuffer()
    expect(b.sampleAt(1, 1000)).toBeNull()
  })

  it("two-point interpolates between surrounding samples", () => {
    const b = new RemoteInterpolationBuffer()
    b.push(1, { serverTimeMs: 100, x: 0, y: 0, vx: 0, vy: 0, facingAngle: 0 })
    b.push(1, { serverTimeMs: 200, x: 100, y: 0, vx: 0, vy: 0, facingAngle: 0 })

    const s = b.sampleAt(1, 150)!
    expect(s.x).toBeCloseTo(50, 5)
    expect(s.y).toBeCloseTo(0, 5)
  })

  it("clamps to the oldest sample when requested time is in the past", () => {
    const b = new RemoteInterpolationBuffer()
    b.push(1, { serverTimeMs: 100, x: 10, y: 10, vx: 0, vy: 0, facingAngle: 0 })
    b.push(1, { serverTimeMs: 200, x: 20, y: 10, vx: 0, vy: 0, facingAngle: 0 })

    expect(b.sampleAt(1, 50)).toEqual({ x: 10, y: 10, facingAngle: 0 })
  })

  it("extrapolates past the newest sample using velocity, up to the cap", () => {
    const b = new RemoteInterpolationBuffer()
    b.push(1, { serverTimeMs: 100, x: 0, y: 0, vx: 100, vy: 0, facingAngle: 0 })

    // 50 ms past = 0 + 100 * 0.05 = 5
    const short = b.sampleAt(1, 150)!
    expect(short.x).toBeCloseTo(5, 5)

    // Far beyond the cap — extrapolation clamps.
    const far = b.sampleAt(1, 100 + REMOTE_EXTRAPOLATION_CAP_MS + 1000)!
    const capped = (REMOTE_EXTRAPOLATION_CAP_MS / 1000) * 100
    expect(far.x).toBeCloseTo(capped, 5)
  })

  it("teleports past pairs farther apart than TELEPORT_THRESHOLD_PX", () => {
    const b = new RemoteInterpolationBuffer()
    b.push(1, { serverTimeMs: 100, x: 0, y: 0, vx: 0, vy: 0, facingAngle: 0 })
    b.push(1, { serverTimeMs: 200, x: 10000, y: 0, vx: 0, vy: 0, facingAngle: 0 })

    const s = b.sampleAt(1, 150)!
    expect(s.x).toBe(10000)
  })

  it("evicts old samples beyond the buffer capacity", () => {
    const b = new RemoteInterpolationBuffer(3)
    for (let i = 0; i < 5; i++) {
      b.push(1, { serverTimeMs: 100 + i * 10, x: i, y: 0, vx: 0, vy: 0, facingAngle: 0 })
    }
    // Oldest should be x=2 (samples 2,3,4 retained).
    const out = b.sampleAt(1, 50)
    expect(out!.x).toBe(2)
  })

  it("remove drops the entity's samples and clears empties everything", () => {
    const b = new RemoteInterpolationBuffer()
    b.push(1, { serverTimeMs: 0, x: 0, y: 0, vx: 0, vy: 0, facingAngle: 0 })
    b.push(2, { serverTimeMs: 0, x: 0, y: 0, vx: 0, vy: 0, facingAngle: 0 })
    b.remove(1)
    expect(b.has(1)).toBe(false)
    expect(b.has(2)).toBe(true)
    b.clear()
    expect(b.has(2)).toBe(false)
  })
})
