import { describe, expect, it } from "vitest"

import { STARTING_GOLD } from "../../shared/balance-config/economy"
import { resolveStartingGold } from "./startingGold"

describe("resolveStartingGold", () => {
  it("uses the shared balance value outside E2E", () => {
    expect(
      resolveStartingGold({
        WIZARD_WARS_E2E: "0",
        WW_E2E_STARTING_GOLD: "100",
      }),
    ).toBe(STARTING_GOLD)
  })

  it("allows E2E to request higher starting gold for shop playtests", () => {
    expect(
      resolveStartingGold({
        WIZARD_WARS_E2E: "1",
        WW_E2E_STARTING_GOLD: "100",
      }),
    ).toBe(100)
  })

  it("falls back for invalid E2E values", () => {
    expect(
      resolveStartingGold({
        WIZARD_WARS_E2E: "1",
        WW_E2E_STARTING_GOLD: "-1",
      }),
    ).toBe(STARTING_GOLD)
  })
})
