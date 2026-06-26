import { describe, expect, it } from "vitest"

import { PlayerInputQueue } from "./playerInputQueue"
import type { PlayerInputPayload } from "@/shared/types"

function input(seq: number, overrides: Partial<PlayerInputPayload> = {}): PlayerInputPayload {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    abilitySlot: null,
    abilityTargetX: 0,
    abilityTargetY: 0,
    weaponPrimary: false,
    weaponSecondary: false,
    weaponTargetX: 0,
    weaponTargetY: 0,
    useQuickItemSlot: null,
    seq,
    clientSendTimeMs: 1_000 + seq,
    ...overrides,
  }
}

describe("PlayerInputQueue", () => {
  it("pushes, peeks, consumes, clears, and exposes logical order", () => {
    const queue = new PlayerInputQueue([input(1), input(2)])

    queue.push(input(3))

    expect(queue.length).toBe(3)
    expect(queue.peek()?.seq).toBe(1)
    expect(queue.latest()?.seq).toBe(3)
    expect(queue.toArray().map((queued) => queued.seq)).toEqual([1, 2, 3])
    expect(queue.consume()?.seq).toBe(1)
    expect(queue.consume()?.seq).toBe(2)
    expect(queue.toArray().map((queued) => queued.seq)).toEqual([3])

    queue.clear()

    expect(queue.length).toBe(0)
    expect(queue.peek()).toBeUndefined()
    expect(queue.latest()).toBeUndefined()
    expect(queue.backingLengthForDiagnostics).toBe(0)
  })

  it("drops stale entries through an ACK cursor without counting cap drops", () => {
    const queue = new PlayerInputQueue([
      input(9),
      input(10),
      input(11),
      input(12),
    ])

    expect(queue.dropThroughSeq(10)).toBe(2)

    expect(queue.length).toBe(2)
    expect(queue.peek()?.seq).toBe(11)
    expect(queue.toArray().map((queued) => queued.seq)).toEqual([11, 12])
  })

  it("trims to cap by dropping the oldest logical entries", () => {
    const queue = new PlayerInputQueue([
      input(1),
      input(2),
      input(3),
      input(4),
      input(5),
    ])

    expect(queue.trimToCap(3)).toBe(2)

    expect(queue.length).toBe(3)
    expect(queue.toArray().map((queued) => queued.seq)).toEqual([3, 4, 5])
  })

  it("consumes while a predicate matches and reports each consumed payload", () => {
    const queue = new PlayerInputQueue([
      input(1, { up: true }),
      input(2, { up: true }),
      input(3, { right: true }),
    ])
    const consumedSeqs: number[] = []

    const consumed = queue.consumeWhile(
      (queued) => queued.up,
      (queued) => consumedSeqs.push(queued.seq),
    )

    expect(consumed).toBe(2)
    expect(consumedSeqs).toEqual([1, 2])
    expect(queue.peek()?.seq).toBe(3)
  })

  it("finds the latest matching held intent without consuming", () => {
    const queue = new PlayerInputQueue([
      input(1, { up: true, weaponTargetX: 10 }),
      input(2, { right: true, weaponTargetX: 20 }),
      input(3, { up: true, weaponTargetX: 30 }),
    ])

    const latestHeld = queue.latestMatchingHeldIntent((queued) => queued.up)

    expect(latestHeld?.seq).toBe(3)
    expect(queue.length).toBe(3)
  })

  it("compacts consumed slots so drained long queues do not retain payloads", () => {
    const queue = new PlayerInputQueue(
      Array.from({ length: 128 }, (_, index) => input(index)),
    )

    while (queue.consume()) {
      // Drain the queue.
    }

    expect(queue.length).toBe(0)
    expect(queue.backingLengthForDiagnostics).toBe(0)
  })
})
