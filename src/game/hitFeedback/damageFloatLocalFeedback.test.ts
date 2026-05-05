import { describe, expect, it } from "vitest"

import { HAZARD_TAKE_HIT_SFX_MIN_INTERVAL_MS } from "@/shared/balance-config/combat"
import { resolveDamageFloatLocalFeedback } from "./damageFloatLocalFeedback"

describe("resolveDamageFloatLocalFeedback", () => {
  const basePayload = {
    targetId: "victim",
    attackerUserId: "attacker" as string | null,
    amount: 10,
    x: 0,
    y: 0,
  }

  it("returns no-op when localPlayerId is null", () => {
    const r = resolveDamageFloatLocalFeedback(null, basePayload, 1000, null)
    expect(r.playDealSfx).toBe(false)
    expect(r.playTakeHitSfx).toBe(false)
    expect(r.flashDealerUserId).toBeNull()
    expect(r.flashVictimUserId).toBeNull()
    expect(r.nextLastHazardTakeHitSfxAtMs).toBeNull()
  })

  it("plays dealer feedback when local is attacker (non-self)", () => {
    const r = resolveDamageFloatLocalFeedback(
      "attacker",
      { ...basePayload, attackerUserId: "attacker" },
      1000,
      null,
    )
    expect(r.playDealSfx).toBe(true)
    expect(r.flashDealerUserId).toBe("attacker")
    expect(r.playTakeHitSfx).toBe(false)
    expect(r.flashVictimUserId).toBeNull()
  })

  it("does not play dealer when attacker equals target", () => {
    const r = resolveDamageFloatLocalFeedback(
      "self",
      {
        ...basePayload,
        targetId: "self",
        attackerUserId: "self",
      },
      1000,
      null,
    )
    expect(r.playDealSfx).toBe(false)
    expect(r.flashDealerUserId).toBeNull()
    expect(r.flashVictimUserId).toBe("self")
    expect(r.playTakeHitSfx).toBe(true)
  })

  it("plays take-hit every time for PvP (attacker set)", () => {
    const p = { ...basePayload, attackerUserId: "attacker" }
    const r = resolveDamageFloatLocalFeedback("victim", p, 1000, null)
    expect(r.playTakeHitSfx).toBe(true)
    expect(r.flashVictimUserId).toBe("victim")
    expect(r.nextLastHazardTakeHitSfxAtMs).toBeNull()
  })

  it("throttles hazard take-hit SFX but flashVictimUserId stays set", () => {
    const hazard = { ...basePayload, attackerUserId: null, targetId: "me" }
    const first = resolveDamageFloatLocalFeedback("me", hazard, 1000, null)
    expect(first.playTakeHitSfx).toBe(true)
    expect(first.flashVictimUserId).toBe("me")
    expect(first.nextLastHazardTakeHitSfxAtMs).toBe(1000)

    const second = resolveDamageFloatLocalFeedback("me", hazard, 1000 + 50, first.nextLastHazardTakeHitSfxAtMs)
    expect(second.playTakeHitSfx).toBe(false)
    expect(second.flashVictimUserId).toBe("me")
    expect(second.nextLastHazardTakeHitSfxAtMs).toBe(1000)

    const third = resolveDamageFloatLocalFeedback(
      "me",
      hazard,
      1000 + HAZARD_TAKE_HIT_SFX_MIN_INTERVAL_MS,
      second.nextLastHazardTakeHitSfxAtMs,
    )
    expect(third.playTakeHitSfx).toBe(true)
    expect(third.nextLastHazardTakeHitSfxAtMs).toBe(1000 + HAZARD_TAKE_HIT_SFX_MIN_INTERVAL_MS)
  })
})
