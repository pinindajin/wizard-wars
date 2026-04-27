import { describe, expect, it } from "vitest"

import { CombatNumbersMode, DEFAULT_COMBAT_NUMBERS_MODE } from "./combatNumbersMode"
import { audioVolumeSchema } from "./audioVolumes"

describe("settings-config", () => {
  it("exports combat numbers modes", () => {
    expect(CombatNumbersMode.OFF).toBe("OFF")
    expect(DEFAULT_COMBAT_NUMBERS_MODE).toBe(CombatNumbersMode.ON)
  })

  it("parses audio volume settings with defaults", () => {
    const parsed = audioVolumeSchema.parse({})
    expect(parsed.bgmVolume).toBeGreaterThanOrEqual(0)
    expect(parsed.sfxVolume).toBeGreaterThanOrEqual(0)
  })
})
