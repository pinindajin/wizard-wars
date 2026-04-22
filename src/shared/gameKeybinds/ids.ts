/**
 * All game keybind action identifiers.
 * These are persisted per-user via user.updateSettings and loaded into GameKeybindContext.
 */
export const GameKeybindActionId = {
  // Movement
  moveUp: "moveUp",
  moveDown: "moveDown",
  moveLeft: "moveLeft",
  moveRight: "moveRight",

  // Abilities (1-5 hotkeys)
  ability1: "ability1",
  ability2: "ability2",
  ability3: "ability3",
  ability4: "ability4",
  ability5: "ability5",

  // Quick items (Q, 6, 7, 8)
  quickItem1: "quickItem1",
  quickItem2: "quickItem2",
  quickItem3: "quickItem3",
  quickItem4: "quickItem4",

  // UI
  openShopModal: "openShopModal",
  openInventoryModal: "openInventoryModal",
  openSettings: "openSettings",
  liveScoreboard: "liveScoreboard",
  closeTopmostModal: "closeTopmostModal",
} as const

export type GameKeybindActionId = (typeof GameKeybindActionId)[keyof typeof GameKeybindActionId]
