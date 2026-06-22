import { describe, expect, it } from "vitest"

import { localWalkFootstepGatesPass } from "./WalkFootstepController"
import { ClientPlayerState } from "../ecs/components"
import type { AbilityRuntimeStates } from "@/shared/types"

type LocalPlayerRow = (typeof ClientPlayerState)[number]

function abilityStates(): AbilityRuntimeStates {
  return {
    fireball: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: null,
      maxCharges: null,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
    jump: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: 4,
      maxCharges: 4,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
  }
}

const baseState: LocalPlayerRow = {
  playerId: "p1",
  username: "a",
  heroId: "red_wizard",
  health: 10,
  maxHealth: 10,
  lives: 3,
  animState: "walk",
  moveState: "moving",
  terrainState: "land",
  castingAbilityId: null,
  facingAngle: 0,
  moveFacingAngle: 0,
  invulnerable: false,
  jumpZ: 0,
  jumpStartedInLava: false,
  hasSwiftBoots: false,
  abilityStates: abilityStates(),
}

describe("localWalkFootstepGatesPass", () => {
  it("is false with no state", () => {
    expect(
      localWalkFootstepGatesPass(
        { up: true, down: false, left: false, right: false },
        null,
      ),
    ).toBe(false)
  })

  it("is false with no keys", () => {
    expect(
      localWalkFootstepGatesPass(
        { up: false, down: false, left: false, right: false },
        baseState,
      ),
    ).toBe(false)
  })

  it("is true when moving on foot with keys", () => {
    expect(
      localWalkFootstepGatesPass(
        { up: true, down: false, left: false, right: false },
        baseState,
      ),
    ).toBe(true)
  })

  it("is false when rooted", () => {
    expect(
      localWalkFootstepGatesPass(
        { up: true, down: false, left: false, right: false },
        { ...baseState, moveState: "rooted" },
      ),
    ).toBe(false)
  })

  it("is false when airborne", () => {
    expect(
      localWalkFootstepGatesPass(
        { up: true, down: false, left: false, right: false },
        { ...baseState, jumpZ: 1 },
      ),
    ).toBe(false)
  })

  it("is false when dying", () => {
    expect(
      localWalkFootstepGatesPass(
        { up: true, down: false, left: false, right: false },
        { ...baseState, animState: "dying" },
      ),
    ).toBe(false)
  })
})
