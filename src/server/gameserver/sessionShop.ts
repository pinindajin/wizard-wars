import { STARTING_GOLD, KILL_REWARD, SHOP_ITEM_COST, ABILITY_BAR_SLOT_COUNT, QUICK_ITEM_SLOT_COUNT } from "../../shared/balance-config/economy"
import { SHOP_ITEMS } from "../../shared/balance-config/items"
import { AUGMENT_CONFIGS } from "../../shared/balance-config/equipment"
import { ABILITY_CONFIGS, DEFAULT_ABILITY_SLOT_0_ID } from "../../shared/balance-config/abilities"
import type { ShopStatePayload, ShopOwnedItem, QuickItemSlot } from "../../shared/types"

/**
 * Per-player in-session economy and inventory state.
 * Session-only: resets at match end. No persistence.
 */
export type SessionEconomy = {
  gold: number
  kills: number
  deaths: number
  /** Owned item IDs (abilities, weapons, augments, consumables). */
  ownedItemIds: Set<string>
  /** Quick item slots (index 0-3 = Q, 6, 7, 8). */
  quickItemSlots: { itemId: string | null; charges: number }[]
  /** Ability bar slots (index 0-4). -1 = empty. */
  abilitySlots: (string | null)[]
  /** Equipped weapon item ID, or null. */
  equippedWeaponId: string | null
  /** Equipped augment item IDs. */
  equippedAugmentIds: Set<string>
}

/**
 * Creates a fresh session economy for a player at match start.
 * Fireball is auto-assigned to ability slot 0.
 *
 * @returns A new SessionEconomy with starting gold and fireball in slot 0.
 */
export const createSessionEconomy = (): SessionEconomy => {
  const abilitySlots: (string | null)[] = Array(ABILITY_BAR_SLOT_COUNT).fill(null)
  abilitySlots[0] = DEFAULT_ABILITY_SLOT_0_ID

  return {
    gold: STARTING_GOLD,
    kills: 0,
    deaths: 0,
    ownedItemIds: new Set<string>([DEFAULT_ABILITY_SLOT_0_ID]),
    quickItemSlots: Array(QUICK_ITEM_SLOT_COUNT).fill(null).map(() => ({ itemId: null, charges: 0 })),
    abilitySlots,
    equippedWeaponId: null,
    equippedAugmentIds: new Set<string>(),
  }
}

/**
 * Attempt to purchase an item from the shop.
 *
 * @param economy - The player's current session economy.
 * @param itemId - The ID of the item to purchase.
 * @returns `{ success: true }` or `{ success: false; reason: string }`.
 */
export const attemptPurchase = (
  economy: SessionEconomy,
  itemId: string,
): { success: true } | { success: false; reason: string } => {
  const item = SHOP_ITEMS[itemId]
  if (!item) {
    return { success: false, reason: "Unknown item" }
  }

  if (economy.gold < item.cost) {
    return { success: false, reason: "Not enough gold" }
  }

  // Augment: check non-stackable
  if (item.category === "augment") {
    const augmentConfig = AUGMENT_CONFIGS[itemId]
    if (augmentConfig && !augmentConfig.stackable && economy.ownedItemIds.has(itemId)) {
      return { success: false, reason: "Already equipped (non-stackable)" }
    }
  }

  // Ability: check if ability bar is full and ability not already owned
  if (item.category === "ability") {
    const alreadyOwned = economy.ownedItemIds.has(itemId)
    if (!alreadyOwned) {
      const emptySlotIndex = economy.abilitySlots.findIndex((s) => s === null)
      if (emptySlotIndex === -1) {
        return { success: false, reason: "Ability bar is full" }
      }
    }
  }

  economy.gold -= item.cost

  if (item.category === "consumable") {
    // Find existing slot with same item type, or first empty slot
    let targetSlot = economy.quickItemSlots.findIndex((s) => s.itemId === itemId)
    if (targetSlot === -1) {
      targetSlot = economy.quickItemSlots.findIndex((s) => s.itemId === null)
    }
    if (targetSlot !== -1) {
      economy.quickItemSlots[targetSlot].itemId = itemId
      economy.quickItemSlots[targetSlot].charges++
    }
  } else if (item.category === "ability") {
    if (!economy.ownedItemIds.has(itemId)) {
      const emptySlotIndex = economy.abilitySlots.findIndex((s) => s === null)
      if (emptySlotIndex !== -1) {
        economy.abilitySlots[emptySlotIndex] = itemId
      }
    }
    economy.ownedItemIds.add(itemId)
  } else if (item.category === "weapon") {
    economy.ownedItemIds.add(itemId)
    economy.equippedWeaponId = itemId
  } else if (item.category === "augment") {
    economy.ownedItemIds.add(itemId)
    economy.equippedAugmentIds.add(itemId)
  }

  return { success: true }
}

/**
 * Awards kill reward gold to a player.
 *
 * @param economy - The killer's session economy.
 */
export const awardKillGold = (economy: SessionEconomy): void => {
  economy.gold += KILL_REWARD
  economy.kills++
}

/**
 * Records a death for a player (increments death counter).
 *
 * @param economy - The dying player's session economy.
 */
export const recordDeath = (economy: SessionEconomy): void => {
  economy.deaths++
}

/**
 * Attempts to use a quick item slot.
 *
 * @param economy - The player's session economy.
 * @param slotIndex - Quick item slot index (0-3).
 * @returns The itemId that was used, or null if the slot is empty.
 */
export const useQuickItemSlot = (economy: SessionEconomy, slotIndex: number): string | null => {
  const slot = economy.quickItemSlots[slotIndex]
  if (!slot || !slot.itemId || slot.charges <= 0) {
    return null
  }
  const itemId = slot.itemId
  slot.charges--
  if (slot.charges === 0) {
    slot.itemId = null
  }
  return itemId
}

/**
 * Builds the ShopStatePayload for broadcasting to the player.
 *
 * @param economy - The player's current session economy.
 * @returns ShopStatePayload for the client.
 */
export const buildShopStatePayload = (economy: SessionEconomy): ShopStatePayload => {
  const items: ShopOwnedItem[] = Array.from(economy.ownedItemIds).map((itemId) => ({
    itemId,
  }))

  const quickItemSlots: QuickItemSlot[] = economy.quickItemSlots.map((s) => ({
    itemId: s.itemId,
    charges: s.charges,
  }))

  return {
    gold: economy.gold,
    items,
    equippedWeaponItemId: economy.equippedWeaponId,
    augmentItemIds: Array.from(economy.equippedAugmentIds),
    abilitySlots: economy.abilitySlots,
    quickItemSlots,
  }
}
