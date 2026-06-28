import { describe, expect, it } from "vitest"

import { PlayerInputStateScheduler } from "./PlayerInputStateScheduler"
import type { PlayerInputPayload, PlayerInputStatePayload } from "@/shared/types"

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

function lastCoveredSeq(state: PlayerInputStatePayload): number {
  if (state.protocolVersion !== 2) throw new Error("expected v2 input state")
  return state.runs[state.runs.length - 1]?.toSeq ?? -1
}

describe("PlayerInputStateScheduler", () => {
  it("emits v2 command runs covering every active held movement seq", () => {
    const scheduler = new PlayerInputStateScheduler()
    const sent = []

    for (let seq = 0; seq <= 6; seq++) {
      const state = scheduler.maybeBuildState(
        input(seq, { right: true }),
        seq * 1000 / 60,
      )
      if (state) sent.push(state)
    }

    expect(sent).toEqual([
      {
        protocolVersion: 2,
        runs: [
          {
            fromSeq: 0,
            toSeq: 0,
            clientSendTimeMs: 0,
            buttons: 8,
            targetX: 100,
            targetY: 200,
          },
        ],
      },
      {
        protocolVersion: 2,
        runs: [
          {
            fromSeq: 1,
            toSeq: 6,
            clientSendTimeMs: 16.6667,
            buttons: 8,
            targetX: 100,
            targetY: 200,
          },
        ],
      },
    ])
  })

  it("splits one-shot ability and quick-item inputs into singleton v2 runs", () => {
    const scheduler = new PlayerInputStateScheduler()

    expect(scheduler.maybeBuildState(input(0, { right: true }), 0)).toEqual({
      protocolVersion: 2,
      runs: [
        {
          fromSeq: 0,
          toSeq: 0,
          clientSendTimeMs: 0,
          buttons: 8,
          targetX: 100,
          targetY: 200,
        },
      ],
    })

    const ability = scheduler.maybeBuildState(
      input(1, { right: true, abilitySlot: 2 }),
      1000 / 60,
    )
    const quick = scheduler.maybeBuildState(
      input(2, { right: true, useQuickItemSlot: 1 }),
      2000 / 60,
    )

    expect(ability).toEqual({
      protocolVersion: 2,
      runs: [
        {
          fromSeq: 1,
          toSeq: 1,
          clientSendTimeMs: 16.6667,
          buttons: 8,
          targetX: 100,
          targetY: 200,
          abilitySlot: 2,
        },
      ],
    })
    expect(quick).toEqual({
      protocolVersion: 2,
      runs: [
        {
          fromSeq: 2,
          toSeq: 2,
          clientSendTimeMs: 33.3334,
          buttons: 8,
          targetX: 100,
          targetY: 200,
          useQuickItemSlot: 1,
        },
      ],
    })
  })

  it("sends initial idle state and bounded idle command runs", () => {
    const scheduler = new PlayerInputStateScheduler()
    const sent: number[] = []

    for (let seq = 0; seq <= 60; seq++) {
      const state = scheduler.maybeBuildState(input(seq), seq * 1000 / 60)
      if (state) sent.push(lastCoveredSeq(state))
    }

    expect(sent).toEqual([0, 30, 60])
  })

  it("sends active held input heartbeats every 100ms", () => {
    const scheduler = new PlayerInputStateScheduler()
    const sent: number[] = []

    for (let seq = 0; seq <= 12; seq++) {
      const state = scheduler.maybeBuildState(
        input(seq, { right: true }),
        seq * 1000 / 60,
      )
      if (state) sent.push(lastCoveredSeq(state))
    }

    expect(sent).toEqual([0, 6, 12])
  })

  it("sends idle weapon target changes as command runs without waiting for idle heartbeat", () => {
    const scheduler = new PlayerInputStateScheduler()

    expect(lastCoveredSeq(scheduler.maybeBuildState(input(0), 0)!)).toBe(0)

    const aim = scheduler.maybeBuildState(input(1, { weaponTargetX: 160 }), 50)

    expect(aim).toEqual({
      protocolVersion: 2,
      runs: [
        {
          fromSeq: 1,
          toSeq: 1,
          clientSendTimeMs: 16.6667,
          buttons: 0,
          targetX: 160,
          targetY: 200,
        },
      ],
    })

    expect(
      scheduler.maybeBuildState(input(2, { weaponTargetX: 160 }), 100),
    ).toBeNull()

    const verticalAim = scheduler.maybeBuildState(
      input(3, { weaponTargetX: 160, weaponTargetY: 260 }),
      150,
    )

    expect(verticalAim).toEqual({
      protocolVersion: 2,
      runs: [
        {
          fromSeq: 2,
          toSeq: 2,
          clientSendTimeMs: 33.3334,
          buttons: 0,
          targetX: 160,
          targetY: 200,
        },
        {
          fromSeq: 3,
          toSeq: 3,
          clientSendTimeMs: 50.000099999999996,
          buttons: 0,
          targetX: 160,
          targetY: 260,
        },
      ],
    })
  })

  it("sends held-button releases immediately", () => {
    const scheduler = new PlayerInputStateScheduler()

    expect(lastCoveredSeq(scheduler.maybeBuildState(input(0, { right: true }), 0)!)).toBe(0)
    expect(scheduler.maybeBuildState(input(1, { right: true }), 1000 / 60)).toBeNull()

    const release = scheduler.maybeBuildState(input(2, { right: false }), 2000 / 60)

    expect(release).toEqual({
      protocolVersion: 2,
      runs: [
        {
          fromSeq: 1,
          toSeq: 1,
          clientSendTimeMs: 16.6667,
          buttons: 8,
          targetX: 100,
          targetY: 200,
        },
        {
          fromSeq: 2,
          toSeq: 2,
          clientSendTimeMs: 33.3334,
          buttons: 0,
          targetX: 100,
          targetY: 200,
        },
      ],
    })
  })

  it("sends one-shot ability and quick-item edges on every armed frame without requiring a null clear", () => {
    const scheduler = new PlayerInputStateScheduler()

    expect(lastCoveredSeq(scheduler.maybeBuildState(input(0), 0)!)).toBe(0)

    const ability1 = scheduler.maybeBuildState(input(1, { abilitySlot: 2 }), 1000 / 60)
    const ability2 = scheduler.maybeBuildState(input(2, { abilitySlot: 2 }), 2000 / 60)
    const cleared = scheduler.maybeBuildState(input(3), 3000 / 60)
    const quick = scheduler.maybeBuildState(input(4, { useQuickItemSlot: 1 }), 4000 / 60)

    expect(ability1).toEqual({
      protocolVersion: 2,
      runs: [
        {
          fromSeq: 1,
          toSeq: 1,
          clientSendTimeMs: 16.6667,
          buttons: 0,
          targetX: 100,
          targetY: 200,
          abilitySlot: 2,
        },
      ],
    })
    expect(ability2).toEqual({
      protocolVersion: 2,
      runs: [
        {
          fromSeq: 2,
          toSeq: 2,
          clientSendTimeMs: 33.3334,
          buttons: 0,
          targetX: 100,
          targetY: 200,
          abilitySlot: 2,
        },
      ],
    })
    expect(cleared).toBeNull()
    expect(quick).toEqual({
      protocolVersion: 2,
      runs: [
        {
          fromSeq: 3,
          toSeq: 3,
          clientSendTimeMs: 50.000099999999996,
          buttons: 0,
          targetX: 100,
          targetY: 200,
        },
        {
          fromSeq: 4,
          toSeq: 4,
          clientSendTimeMs: 66.6668,
          buttons: 0,
          targetX: 100,
          targetY: 200,
          useQuickItemSlot: 1,
        },
      ],
    })
  })

  it("forces the next state after reset so reconnects do not inherit stale transport state", () => {
    const scheduler = new PlayerInputStateScheduler()

    expect(lastCoveredSeq(scheduler.maybeBuildState(input(0), 0)!)).toBe(0)
    expect(scheduler.maybeBuildState(input(1), 1000 / 60)).toBeNull()

    scheduler.reset()

    expect(lastCoveredSeq(scheduler.maybeBuildState(input(2), 2000 / 60)!)).toBe(2)
  })
})
