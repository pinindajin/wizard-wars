import { describe, expect, it } from "vitest"

import { createDefaultGameKeybindConfig } from "./defaults"
import { GameKeybindActionId } from "./ids"
import { DEFAULT_KEYBINDS, GAME_KEYBIND_ACTION_IDS } from "./lobbyKeybinds"

describe("gameKeybinds", () => {
  it("creates default in-arena keybind config", () => {
    const cfg = createDefaultGameKeybindConfig()
    expect(cfg.moveUp).toBe("KeyW")
    expect(Object.keys(cfg).length).toBeGreaterThan(10)
  })

  it("exports stable action id constants", () => {
    expect(GameKeybindActionId.moveUp).toBe("moveUp")
  })

  it("exports lobby-style defaults and id list", () => {
    expect(GAME_KEYBIND_ACTION_IDS).toContain("move_up")
    expect(DEFAULT_KEYBINDS.move_up).toBe("w")
  })
})
