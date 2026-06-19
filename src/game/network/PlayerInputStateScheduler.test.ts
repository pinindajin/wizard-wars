import { describe, expect, it } from "vitest"

import { PlayerInputStateScheduler } from "./PlayerInputStateScheduler"
import type { PlayerInputPayload } from "@/shared/types"

function input(seq: number, overrides: Partial<PlayerInputPayload> = {}): PlayerInputPayload {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    abilitySlot: null,
    abilityTargetX: 100,
    abilityTargetY: 200,
    weaponPrimary: false,
    weaponSecondary: false,
    weaponTargetX: 100,
    weaponTargetY: 200,
    useQuickItemSlot: null,
    seq,
    clientSendTimeMs: seq * 16.6667,
    ...overrides,
  }
}

describe("PlayerInputStateScheduler", () => {
  it("sends initial idle state and then only idle heartbeats once per second", () => {
    const scheduler = new PlayerInputStateScheduler()
    const sent: number[] = []

    for (let seq = 0; seq <= 60; seq++) {
      const state = scheduler.maybeBuildState(input(seq), seq * 1000 / 60)
      if (state) sent.push(state.seq)
    }

    expect(sent).toEqual([0, 60])
  })

  it("sends active held input heartbeats every 100ms", () => {
    const scheduler = new PlayerInputStateScheduler()
    const sent: number[] = []

    for (let seq = 0; seq <= 12; seq++) {
      const state = scheduler.maybeBuildState(
        input(seq, { right: true }),
        seq * 1000 / 60,
      )
      if (state) sent.push(state.seq)
    }

    expect(sent).toEqual([0, 6, 12])
  })

  it("sends held-button releases immediately", () => {
    const scheduler = new PlayerInputStateScheduler()

    expect(scheduler.maybeBuildState(input(0, { right: true }), 0)?.seq).toBe(0)
    expect(scheduler.maybeBuildState(input(1, { right: true }), 1000 / 60)).toBeNull()

    const release = scheduler.maybeBuildState(input(2, { right: false }), 2000 / 60)

    expect(release).toMatchObject({ seq: 2, buttons: 0 })
  })

  it("sends one-shot ability and quick-item edges on every armed frame without requiring a null clear", () => {
    const scheduler = new PlayerInputStateScheduler()

    expect(scheduler.maybeBuildState(input(0), 0)?.seq).toBe(0)

    const ability1 = scheduler.maybeBuildState(input(1, { abilitySlot: 2 }), 1000 / 60)
    const ability2 = scheduler.maybeBuildState(input(2, { abilitySlot: 2 }), 2000 / 60)
    const cleared = scheduler.maybeBuildState(input(3), 3000 / 60)
    const quick = scheduler.maybeBuildState(input(4, { useQuickItemSlot: 1 }), 4000 / 60)

    expect(ability1).toMatchObject({ seq: 1, abilitySlot: 2 })
    expect(ability2).toMatchObject({ seq: 2, abilitySlot: 2 })
    expect(cleared).toBeNull()
    expect(quick).toMatchObject({ seq: 4, useQuickItemSlot: 1 })
  })

  it("forces the next state after reset so reconnects do not inherit stale transport state", () => {
    const scheduler = new PlayerInputStateScheduler()

    expect(scheduler.maybeBuildState(input(0), 0)?.seq).toBe(0)
    expect(scheduler.maybeBuildState(input(1), 1000 / 60)).toBeNull()

    scheduler.reset()

    expect(scheduler.maybeBuildState(input(2), 2000 / 60)?.seq).toBe(2)
  })
})
