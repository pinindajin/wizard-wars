import { describe, expect, it } from "vitest"

import { LocalInputHistory } from "./LocalInputHistory"
import type { PlayerInputPayload } from "@/shared/types"

function input(seq: number): PlayerInputPayload {
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
    clientSendTimeMs: seq * 10,
  }
}

describe("LocalInputHistory", () => {
  it("appends inputs and returns them in order", () => {
    const h = new LocalInputHistory()
    h.append(input(1))
    h.append(input(2))
    h.append(input(3))
    expect(h.pending().map((i) => i.seq)).toEqual([1, 2, 3])
  })

  it("drops entries with seq <= ack", () => {
    const h = new LocalInputHistory()
    for (const s of [1, 2, 3, 4, 5]) h.append(input(s))
    h.discardThrough(3)
    expect(h.pending().map((i) => i.seq)).toEqual([4, 5])
  })

  it("noop when ack is below tail", () => {
    const h = new LocalInputHistory()
    for (const s of [10, 11]) h.append(input(s))
    h.discardThrough(5)
    expect(h.pending().map((i) => i.seq)).toEqual([10, 11])
  })

  it("evicts the oldest entry when capacity is exceeded", () => {
    const h = new LocalInputHistory(3)
    for (const s of [1, 2, 3, 4]) h.append(input(s))
    expect(h.pending().map((i) => i.seq)).toEqual([2, 3, 4])
  })

  it("size reflects pending count and clear empties the buffer", () => {
    const h = new LocalInputHistory()
    h.append(input(1))
    h.append(input(2))
    expect(h.size()).toBe(2)
    h.clear()
    expect(h.size()).toBe(0)
    expect(h.pending()).toEqual([])
  })
})
