/**
 * Lobby in-game keybinds (used by the settings modal, HUD labels, and Phaser
 * `KeyboardController`). Kept in `shared` so the game client never imports
 * React context modules at runtime.
 */
export const GAME_KEYBIND_ACTION_IDS = [
  "move_up",
  "move_down",
  "move_left",
  "move_right",
  "ability_1",
  "ability_2",
  "ability_3",
  "ability_4",
  "ability_5",
  "quick_item_1",
  "quick_item_2",
  "quick_item_3",
  "quick_item_4",
  "open_settings",
  "scoreboard",
  "weapon_primary",
  "weapon_secondary",
] as const

/** A single keybind action identifier. */
export type GameKeybindActionId = (typeof GAME_KEYBIND_ACTION_IDS)[number]

/** Default keybind assignments. */
export const DEFAULT_KEYBINDS: Record<GameKeybindActionId, string> = {
  move_up: "w",
  move_down: "s",
  move_left: "a",
  move_right: "d",
  ability_1: "1",
  ability_2: "2",
  ability_3: "3",
  ability_4: "4",
  ability_5: "5",
  quick_item_1: "q",
  quick_item_2: "6",
  quick_item_3: "7",
  quick_item_4: "8",
  open_settings: "\\",
  scoreboard: "Tab",
  weapon_primary: "MouseLeft",
  weapon_secondary: "MouseRight",
}

/** The keybind config map (action ID → key string). */
export type KeybindConfig = Record<GameKeybindActionId, string>
