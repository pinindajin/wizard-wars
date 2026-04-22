import type { GameKeybindActionId } from "./ids"

/** Maps each GameKeybindActionId to a browser key string (KeyboardEvent.code or "MouseLeft"/"MouseRight"). */
export type GameKeybindConfig = Record<GameKeybindActionId, string>

/**
 * Returns the default wizard-wars keybind configuration.
 * All values are KeyboardEvent.code strings or special mouse codes.
 *
 * @returns Default keybind config object.
 */
export const createDefaultGameKeybindConfig = (): GameKeybindConfig => ({
  moveUp: "KeyW",
  moveDown: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  ability1: "Digit1",
  ability2: "Digit2",
  ability3: "Digit3",
  ability4: "Digit4",
  ability5: "Digit5",
  quickItem1: "KeyQ",
  quickItem2: "Digit6",
  quickItem3: "Digit7",
  quickItem4: "Digit8",
  openShopModal: "KeyB",
  openInventoryModal: "KeyI",
  openSettings: "Backslash",
  liveScoreboard: "Tab",
  closeTopmostModal: "Escape",
})
