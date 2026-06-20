import { describe, expect, it } from "vitest"

import {
  decodePlayerInputState,
  encodePlayerInputState,
  PLAYER_INPUT_BUTTONS_MAX,
} from "./playerInputState"
import { playerInputStatePayloadSchema } from "./validators"
import type { PlayerInputPayload, PlayerInputStatePayload } from "./types"

function fullInput(overrides: Partial<PlayerInputPayload> = {}): PlayerInputPayload {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    abilitySlot: null,
    abilityTargetX: 10,
    abilityTargetY: 20,
    weaponPrimary: false,
    weaponSecondary: false,
    weaponTargetX: 10,
    weaponTargetY: 20,
    useQuickItemSlot: null,
    seq: 7,
    clientSendTimeMs: 1_000,
    ...overrides,
  }
}

describe("player input state codec", () => {
  it("encodes held buttons and one-shot slots into a compact state payload", () => {
    expect(
      encodePlayerInputState(
        fullInput({
          up: true,
          right: true,
          weaponPrimary: true,
          abilitySlot: 2,
          useQuickItemSlot: 1,
          weaponTargetX: 300,
          weaponTargetY: 400,
          abilityTargetX: 300,
          abilityTargetY: 400,
        }),
      ),
    ).toEqual({
      protocolVersion: 1,
      seq: 7,
      clientSendTimeMs: 1_000,
      buttons: 1 | 8 | 16,
      targetX: 300,
      targetY: 400,
      abilitySlot: 2,
      useQuickItemSlot: 1,
    })
  })

  it("encodes every held button bit", () => {
    expect(
      encodePlayerInputState(
        fullInput({
          up: true,
          down: true,
          left: true,
          right: true,
          weaponPrimary: true,
          weaponSecondary: true,
        }),
      ).buttons,
    ).toBe(PLAYER_INPUT_BUTTONS_MAX)
  })

  it("decodes compact state payloads into canonical full input payloads", () => {
    const state: PlayerInputStatePayload = {
      protocolVersion: 1,
      seq: 9,
      clientSendTimeMs: 2_000,
      buttons: 2 | 32,
      targetX: 500,
      targetY: 600,
    }

    expect(decodePlayerInputState(state)).toEqual({
      up: false,
      down: true,
      left: false,
      right: false,
      abilitySlot: null,
      abilityTargetX: 500,
      abilityTargetY: 600,
      weaponPrimary: false,
      weaponSecondary: true,
      weaponTargetX: 500,
      weaponTargetY: 600,
      useQuickItemSlot: null,
      seq: 9,
      clientSendTimeMs: 2_000,
    })
  })

  it("validates compact bitmask and slot bounds", () => {
    const valid = {
      protocolVersion: 1,
      seq: 1,
      clientSendTimeMs: 1_000,
      buttons: PLAYER_INPUT_BUTTONS_MAX,
      targetX: 0,
      targetY: 0,
      abilitySlot: 4,
      useQuickItemSlot: 3,
    }

    expect(playerInputStatePayloadSchema.safeParse(valid).success).toBe(true)
    expect(
      playerInputStatePayloadSchema.safeParse({
        ...valid,
        buttons: PLAYER_INPUT_BUTTONS_MAX + 1,
      }).success,
    ).toBe(false)
    expect(
      playerInputStatePayloadSchema.safeParse({ ...valid, abilitySlot: 5 }).success,
    ).toBe(false)
    expect(
      playerInputStatePayloadSchema.safeParse({ ...valid, useQuickItemSlot: 4 })
        .success,
    ).toBe(false)
  })
})
