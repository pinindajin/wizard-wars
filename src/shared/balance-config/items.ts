import { SHOP_ITEM_COST } from "./economy"

export type ShopItemCategory = "ability" | "augment" | "consumable"

export type ShopItemConfig = {
  readonly id: string
  readonly displayName: string
  readonly cost: number
  readonly category: ShopItemCategory
  readonly description: string
}

export const SHOP_ITEMS: Record<string, ShopItemConfig> = {
  lightning_bolt: {
    id: "lightning_bolt",
    displayName: "Lightning Bolt",
    cost: SHOP_ITEM_COST,
    category: "ability",
    description: "Instant 350px arc, 40 damage (Magic | Electric). Cooldown 4s.",
  },
  healing_potion: {
    id: "healing_potion",
    displayName: "Healing Potion",
    cost: SHOP_ITEM_COST,
    category: "consumable",
    description: "Instantly restores 50 HP. Charges stack.",
  },
  swift_boots: {
    id: "swift_boots",
    displayName: "Swift Boots",
    cost: SHOP_ITEM_COST,
    category: "augment",
    description: "+10% move speed. Non-stackable.",
  },
  jump: {
    id: "jump",
    displayName: "Jump",
    cost: 0,
    category: "ability",
    description: "Leap over hazards; props and bounds still block. Cooldown on press.",
  },
}
