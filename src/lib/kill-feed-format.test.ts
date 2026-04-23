import { describe, it, expect } from "vitest"

import { formatKillFeedLine, killFeedAbilityLabel } from "./kill-feed-format"
import type { PlayerDeathPayload } from "@/shared/types"

describe("killFeedAbilityLabel", () => {
  it("maps known abilities", () => {
    expect(killFeedAbilityLabel("fireball")).toBe("Fireball")
    expect(killFeedAbilityLabel("axe")).toBe("Axe")
  })

  it("handles null", () => {
    expect(killFeedAbilityLabel(null)).toBe("unknown")
  })
})

describe("formatKillFeedLine", () => {
  const base: PlayerDeathPayload = {
    playerId: "p1",
    killerPlayerId: "p2",
    killerAbilityId: "fireball",
    livesRemaining: 2,
    x: 0,
    y: 0,
    victimUsername: "Vic",
    killerUsername: "Kil",
  }

  it("formats a normal kill", () => {
    expect(formatKillFeedLine(base)).toBe("Kil eliminated Vic (Fireball)")
  })

  it("uses ids when usernames missing", () => {
    expect(
      formatKillFeedLine({
        ...base,
        victimUsername: undefined,
        killerUsername: undefined,
      }),
    ).toBe("p2 eliminated p1 (Fireball)")
  })

  it("formats self-kill", () => {
    expect(
      formatKillFeedLine({
        ...base,
        killerPlayerId: "p1",
        victimUsername: "Vic",
      }),
    ).toBe("Vic — self (Fireball)")
  })

  it("formats unknown killer", () => {
    expect(
      formatKillFeedLine({
        ...base,
        killerPlayerId: null,
        killerUsername: undefined,
        killerAbilityId: null,
      }),
    ).toBe("Vic died (unknown)")
  })
})
