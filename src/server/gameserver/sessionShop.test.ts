import { describe, it, expect } from "vitest"
import {
  createSessionEconomy, attemptPurchase, awardKillGold, recordDeath, useQuickItemSlot, buildShopStatePayload,
} from "@/server/gameserver/sessionShop"
import { STARTING_GOLD, KILL_REWARD, SHOP_ITEM_COST, ABILITY_BAR_SLOT_COUNT } from "@/shared/balance-config/economy"

describe("createSessionEconomy", () => {
  it("starts with correct gold", () => {
    const economy = createSessionEconomy()
    expect(economy.gold).toBe(STARTING_GOLD)
  })

  it("has fireball in slot 0", () => {
    const economy = createSessionEconomy()
    expect(economy.abilitySlots[0]).toBe("fireball")
    expect(economy.abilitySlots[1]).toBe(null)
  })

  it("has empty quick item slots", () => {
    const economy = createSessionEconomy()
    for (const slot of economy.quickItemSlots) {
      expect(slot.itemId).toBe(null)
      expect(slot.charges).toBe(0)
    }
  })

  it("has no equipped weapon", () => {
    const economy = createSessionEconomy()
    expect(economy.equippedWeaponId).toBe(null)
  })
})

describe("attemptPurchase", () => {
  it("purchases lightning bolt and adds to ability slots", () => {
    const economy = createSessionEconomy()
    const result = attemptPurchase(economy, "lightning_bolt")
    expect(result.success).toBe(true)
    expect(economy.gold).toBe(STARTING_GOLD - SHOP_ITEM_COST)
    expect(economy.abilitySlots).toContain("lightning_bolt")
  })

  it("fails with insufficient gold", () => {
    const economy = createSessionEconomy()
    economy.gold = 5 // less than SHOP_ITEM_COST = 10
    const result = attemptPurchase(economy, "lightning_bolt")
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toMatch(/gold/i)
    }
  })

  it("purchases axe and equips it", () => {
    const economy = createSessionEconomy()
    economy.gold = 20
    const result = attemptPurchase(economy, "axe")
    expect(result.success).toBe(true)
    expect(economy.equippedWeaponId).toBe("axe")
  })

  it("purchases swift boots and marks them equipped", () => {
    const economy = createSessionEconomy()
    const result = attemptPurchase(economy, "swift_boots")
    expect(result.success).toBe(true)
    expect(economy.equippedAugmentIds.has("swift_boots")).toBe(true)
  })

  it("blocks second swift boots purchase (non-stackable)", () => {
    const economy = createSessionEconomy()
    economy.gold = 30
    attemptPurchase(economy, "swift_boots")
    const result = attemptPurchase(economy, "swift_boots")
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toMatch(/stackable/i)
    }
  })

  it("stacks healing potion charges", () => {
    const economy = createSessionEconomy()
    economy.gold = 40
    attemptPurchase(economy, "healing_potion")
    attemptPurchase(economy, "healing_potion")
    const potionSlot = economy.quickItemSlots.find((s) => s.itemId === "healing_potion")
    expect(potionSlot?.charges).toBe(2)
  })

  it("fails when ability bar is full and ability not owned", () => {
    const economy = createSessionEconomy()
    economy.gold = 100
    // Fill all ability slots
    for (let i = 1; i < ABILITY_BAR_SLOT_COUNT; i++) {
      economy.abilitySlots[i] = "some_ability"
    }
    // All 5 slots now occupied
    const result = attemptPurchase(economy, "lightning_bolt")
    expect(result.success).toBe(false)
  })

  it("rejects unknown item", () => {
    const economy = createSessionEconomy()
    const result = attemptPurchase(economy, "unknown_item_xyz")
    expect(result.success).toBe(false)
  })
})

describe("awardKillGold", () => {
  it("adds KILL_REWARD gold and increments kills", () => {
    const economy = createSessionEconomy()
    const initialGold = economy.gold
    awardKillGold(economy)
    expect(economy.gold).toBe(initialGold + KILL_REWARD)
    expect(economy.kills).toBe(1)
  })
})

describe("recordDeath", () => {
  it("increments deaths", () => {
    const economy = createSessionEconomy()
    recordDeath(economy)
    expect(economy.deaths).toBe(1)
  })
})

describe("useQuickItemSlot", () => {
  it("consumes a charge and returns itemId", () => {
    const economy = createSessionEconomy()
    economy.gold = 20
    attemptPurchase(economy, "healing_potion")
    const itemId = useQuickItemSlot(economy, 0)
    expect(itemId).toBe("healing_potion")
    const slot = economy.quickItemSlots[0]
    expect(slot.charges).toBe(0)
    expect(slot.itemId).toBe(null) // slot cleared when charges hit 0
  })

  it("returns null for empty slot", () => {
    const economy = createSessionEconomy()
    const itemId = useQuickItemSlot(economy, 0)
    expect(itemId).toBe(null)
  })

  it("decrements charges without clearing slot when charges remain", () => {
    const economy = createSessionEconomy()
    economy.gold = 30
    attemptPurchase(economy, "healing_potion")
    attemptPurchase(economy, "healing_potion")
    useQuickItemSlot(economy, 0)
    const slot = economy.quickItemSlots[0]
    expect(slot.charges).toBe(1)
    expect(slot.itemId).toBe("healing_potion")
  })
})

describe("buildShopStatePayload", () => {
  it("includes gold in payload", () => {
    const economy = createSessionEconomy()
    const payload = buildShopStatePayload(economy)
    expect(payload.gold).toBe(STARTING_GOLD)
  })

  it("includes ability slots", () => {
    const economy = createSessionEconomy()
    const payload = buildShopStatePayload(economy)
    expect(payload.abilitySlots[0]).toBe("fireball")
    expect(payload.abilitySlots[1]).toBe(null)
  })
})
