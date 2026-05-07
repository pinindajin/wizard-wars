import { describe, expect, it } from "vitest"

import type { AbilityRuntimeStates, GameStateSyncPayload } from "@/shared/types"

import {
  EMPTY_ABILITY_RUNTIME_STATES,
  abilityStatesFromBatchDelta,
  abilityStatesFromFullSync,
  estimateServerNowMs,
  sampleServerClock,
} from "./abilityRuntimeHudState"

function abilityStates(charges: number): AbilityRuntimeStates {
  return {
    jump: {
      cooldownEndsAtServerTimeMs: charges === 0 ? 6_000 : null,
      cooldownDurationMs: charges === 0 ? 5_000 : null,
      charges,
      maxCharges: 4,
      rechargeEndsAtServerTimeMs: charges < 4 ? 6_000 : null,
      rechargeDurationMs: charges < 4 ? 5_000 : null,
    },
  }
}

function syncPayload(states: AbilityRuntimeStates): GameStateSyncPayload {
  return {
    players: [
      {
        id: 1,
        playerId: "local",
        username: "Local",
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        facingAngle: 0,
        moveFacingAngle: 0,
        health: 100,
        maxHealth: 100,
        lives: 3,
        heroId: "red_wizard",
        animState: "idle",
        moveState: "idle",
        terrainState: "land",
        castingAbilityId: null,
        invulnerable: false,
        jumpZ: 0,
        jumpStartedInLava: false,
        abilityStates: states,
        lastProcessedInputSeq: 0,
      },
    ],
    fireballs: [],
    seq: 0,
    serverTimeMs: 1_000,
  }
}

describe("ability runtime HUD state", () => {
  it("estimates server time from a receipt-time sample", () => {
    const sample = sampleServerClock(10_000, 500)

    expect(estimateServerNowMs(sample, 800)).toBe(10_300)
  })

  it("uses local time before a server clock sample and clamps negative local elapsed time", () => {
    expect(estimateServerNowMs(null, 800)).toBe(800)
    expect(estimateServerNowMs(sampleServerClock(10_000, 500), 400)).toBe(10_000)
  })

  it("extracts the local player's ability states from full sync", () => {
    const states = abilityStates(3)

    expect(abilityStatesFromFullSync(syncPayload(states), "local")).toBe(states)
  })

  it("returns empty ability states when full sync has no local player match", () => {
    const states = abilityStates(3)
    const payload = syncPayload(states)

    expect(abilityStatesFromFullSync(payload, null)).toBe(EMPTY_ABILITY_RUNTIME_STATES)
    expect(abilityStatesFromFullSync(payload, "missing")).toBe(
      EMPTY_ABILITY_RUNTIME_STATES,
    )
  })

  it("applies only local player ability state batch deltas", () => {
    const current = abilityStates(4)
    const next = abilityStates(0)
    const entityToPlayer = new Map([
      [1, "local"],
      [2, "remote"],
    ])

    const unchanged = abilityStatesFromBatchDelta(
      current,
      { deltas: [{ id: 2, abilityStates: next }], removedIds: [], seq: 0, serverTimeMs: 1 },
      "local",
      entityToPlayer,
    )
    const changed = abilityStatesFromBatchDelta(
      current,
      { deltas: [{ id: 1, abilityStates: next }], removedIds: [], seq: 0, serverTimeMs: 2 },
      "local",
      entityToPlayer,
    )

    expect(unchanged).toBe(current)
    expect(changed).toBe(next)
  })

  it("ignores batch deltas without a local id or ability state payload", () => {
    const current = abilityStates(4)
    const entityToPlayer = new Map([[1, "local"]])

    expect(
      abilityStatesFromBatchDelta(
        current,
        { deltas: [{ id: 1 }], removedIds: [], seq: 0, serverTimeMs: 1 },
        "local",
        entityToPlayer,
      ),
    ).toBe(current)
    expect(
      abilityStatesFromBatchDelta(
        current,
        {
          deltas: [{ id: 1, abilityStates: abilityStates(0) }],
          removedIds: [],
          seq: 0,
          serverTimeMs: 1,
        },
        null,
        entityToPlayer,
      ),
    ).toBe(current)
  })
})
