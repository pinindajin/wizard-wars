/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { AbilityRuntimeStates } from "@/shared/types"

import AbilityBar from "./AbilityBar"

vi.mock("./GameKeybindContext", () => ({
  useGameKeybinds: () => ({
    ability_1: "Digit1",
    ability_2: "Digit2",
    ability_3: "Digit3",
    ability_4: "Digit4",
    ability_5: "Digit5",
  }),
}))

function readyState(): AbilityRuntimeStates {
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
    homing_orb: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: 4,
      maxCharges: 4,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
  }
}

describe("AbilityBar", () => {
  it("renders a heavy cooldown overlay and countdown for unavailable spells", () => {
    render(
      <AbilityBar
        slots={["fireball", null, null, null, null]}
        serverNowMs={1_000}
        abilityStates={{
          ...readyState(),
          fireball: {
            cooldownEndsAtServerTimeMs: 4_500,
            cooldownDurationMs: 4_000,
            charges: null,
            maxCharges: null,
            rechargeEndsAtServerTimeMs: null,
            rechargeDurationMs: null,
          },
        }}
      />,
    )

    expect(
      screen
        .getByTestId("ability-slot-0-cooldown-overlay")
        .getAttribute("data-cooldown-kind"),
    ).toBe("heavy")
    expect(screen.getByTestId("ability-slot-0-cooldown-countdown").textContent).toBe("4")
  })

  it("renders jump charges with a light recharge overlay while still usable", () => {
    render(
      <AbilityBar
        slots={["jump", null, null, null, null]}
        serverNowMs={1_000}
        abilityStates={{
          ...readyState(),
          jump: {
            cooldownEndsAtServerTimeMs: null,
            cooldownDurationMs: null,
            charges: 3,
            maxCharges: 4,
            rechargeEndsAtServerTimeMs: 6_000,
            rechargeDurationMs: 5_000,
          },
        }}
      />,
    )

    expect(screen.getByTestId("ability-slot-0-charge-count").textContent).toBe("3")
    expect(
      screen
        .getByTestId("ability-slot-0-cooldown-overlay")
        .getAttribute("data-cooldown-kind"),
    ).toBe("light")
    expect(screen.getByTestId("ability-slot-0-cooldown-countdown").textContent).toBe("5")
  })

  it("renders a heavy disabled overlay when a charge-based ability has no charges", () => {
    render(
      <AbilityBar
        slots={["jump", null, null, null, null]}
        serverNowMs={1_000}
        abilityStates={{
          ...readyState(),
          jump: {
            cooldownEndsAtServerTimeMs: 6_000,
            cooldownDurationMs: 5_000,
            charges: 0,
            maxCharges: 4,
            rechargeEndsAtServerTimeMs: 6_000,
            rechargeDurationMs: 5_000,
          },
        }}
      />,
    )

    expect(screen.getByTestId("ability-slot-0-charge-count").textContent).toBe("0")
    expect(
      screen
        .getByTestId("ability-slot-0-cooldown-overlay")
        .getAttribute("data-cooldown-kind"),
    ).toBe("heavy")
  })

  it("renders Homing Orb charges and recharge like other charge abilities", () => {
    render(
      <AbilityBar
        slots={["homing_orb", null, null, null, null]}
        serverNowMs={1_000}
        abilityStates={{
          ...readyState(),
          homing_orb: {
            cooldownEndsAtServerTimeMs: null,
            cooldownDurationMs: null,
            charges: 3,
            maxCharges: 4,
            rechargeEndsAtServerTimeMs: 16_000,
            rechargeDurationMs: 15_000,
          },
        }}
      />,
    )

    expect(screen.getByTestId("ability-slot-0-charge-count").textContent).toBe("3")
    expect(screen.getByTestId("ability-slot-0").textContent).toContain("Homi")
    expect(
      screen
        .getByTestId("ability-slot-0-cooldown-overlay")
        .getAttribute("data-cooldown-kind"),
    ).toBe("light")
  })
})
