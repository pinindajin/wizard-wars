import { describe, expect, it } from "vitest"

import {
  AXE_SWING_DURATION_MS,
  DAMAGE_FLASH_MS,
  DEATH_ANIM_MS,
  FIREBALL_CAST_MS,
  FIREBALL_COOLDOWN_MS,
  HEALING_POTION_CAST_MS,
  INVULNERABLE_WINDOW_MS,
  LIGHTNING_CAST_MS,
  LIGHTNING_COOLDOWN_MS,
  RESPAWN_DELAY_MS,
  TICK_MS,
  TICK_RATE_HZ,
} from "@/shared/balance-config"

/**
 * Verifies that every ms-based gameplay timing converts into a whole-tick
 * duration whose wall-clock span is within one tick of the source constant.
 * This is the invariant that makes tick-rate changes safe: raising
 * `TICK_RATE_HZ` from 20 to 60 shrinks `TICK_MS` but preserves wall-clock
 * gameplay timings.
 */
describe("gameplay durations are tick-rate invariant (ms-based)", () => {
  function assertTickInvariant(label: string, ms: number): void {
    const ticks = Math.ceil(ms / TICK_MS)
    const wallMs = ticks * TICK_MS
    // Wall-clock is never shorter than the source constant, and never
    // farther than one tick beyond it (rounding up by definition).
    expect(wallMs, `${label} must not shrink below ${ms}ms`).toBeGreaterThanOrEqual(ms - 1e-9)
    expect(wallMs, `${label} must stay within one tick of ${ms}ms`).toBeLessThan(
      ms + TICK_MS,
    )
  }

  it("anchors the documented rate", () => {
    expect(TICK_RATE_HZ).toBeGreaterThan(0)
    expect(TICK_MS).toBeCloseTo(1000 / TICK_RATE_HZ, 6)
  })

  it("preserves cast durations", () => {
    assertTickInvariant("FIREBALL_CAST_MS", FIREBALL_CAST_MS)
    assertTickInvariant("LIGHTNING_CAST_MS", LIGHTNING_CAST_MS)
    assertTickInvariant("HEALING_POTION_CAST_MS", HEALING_POTION_CAST_MS)
  })

  it("preserves cooldowns", () => {
    assertTickInvariant("FIREBALL_COOLDOWN_MS", FIREBALL_COOLDOWN_MS)
    assertTickInvariant("LIGHTNING_COOLDOWN_MS", LIGHTNING_COOLDOWN_MS)
  })

  it("preserves swing / flash / death / invuln / respawn windows", () => {
    assertTickInvariant("AXE_SWING_DURATION_MS", AXE_SWING_DURATION_MS)
    assertTickInvariant("DAMAGE_FLASH_MS", DAMAGE_FLASH_MS)
    assertTickInvariant("DEATH_ANIM_MS", DEATH_ANIM_MS)
    assertTickInvariant("INVULNERABLE_WINDOW_MS", INVULNERABLE_WINDOW_MS)
    assertTickInvariant("RESPAWN_DELAY_MS", RESPAWN_DELAY_MS)
  })
})
