/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

import ShopModal from "./ShopModal"
import type { GameConnection } from "@/game/network/GameConnection"
import type { ShopStatePayload } from "@/shared/types"

/**
 * Builds a minimal mocked `GameConnection` exposing just the send helpers the
 * modal uses. Cast to `GameConnection` for the prop type.
 */
function makeConnection() {
  return {
    sendShopPurchase: vi.fn(),
    sendAssignAbility: vi.fn(),
    sendUseQuickItem: vi.fn(),
  } as unknown as GameConnection & {
    sendShopPurchase: ReturnType<typeof vi.fn>
    sendAssignAbility: ReturnType<typeof vi.fn>
    sendUseQuickItem: ReturnType<typeof vi.fn>
  }
}

/**
 * Default shop state for a player with some gold and no items.
 */
function makeState(overrides?: Partial<ShopStatePayload>): ShopStatePayload {
  return {
    gold: 50,
    items: [],
    augmentItemIds: [],
    abilitySlots: [null, null, null, null, null],
    quickItemSlots: [
      { itemId: null, charges: 0 },
      { itemId: null, charges: 0 },
      { itemId: null, charges: 0 },
      { itemId: null, charges: 0 },
    ],
    ...overrides,
  }
}

describe("ShopModal", () => {
  it("renders ability, augment, and consumable sections with at least one item", () => {
    const onClose = vi.fn()
    render(
      <ShopModal
        shopState={makeState()}
        connection={makeConnection()}
        onClose={onClose}
      />,
    )
    expect(screen.getByTestId("shop-section-ability")).toBeDefined()
    expect(screen.getByTestId("shop-section-augment")).toBeDefined()
    expect(screen.getByTestId("shop-section-consumable")).toBeDefined()
  })

  it("does not render weapon section", () => {
    render(
      <ShopModal shopState={makeState()} connection={makeConnection()} onClose={() => {}} />,
    )
    expect(screen.queryByTestId("shop-section-weapon")).toBeNull()
  })

  it("disables buy when gold < cost and enables otherwise", () => {
    const poor = makeState({ gold: 0 })
    const { rerender } = render(
      <ShopModal shopState={poor} connection={makeConnection()} onClose={() => {}} />,
    )
    const buy = screen.getByTestId("shop-buy-lightning_bolt") as HTMLButtonElement
    expect(buy.disabled).toBe(true)

    rerender(
      <ShopModal
        shopState={makeState({ gold: 100 })}
        connection={makeConnection()}
        onClose={() => {}}
      />,
    )
    const buy2 = screen.getByTestId("shop-buy-lightning_bolt") as HTMLButtonElement
    expect(buy2.disabled).toBe(false)
  })

  it("calls sendShopPurchase when buy is clicked", () => {
    const conn = makeConnection()
    render(
      <ShopModal shopState={makeState()} connection={conn} onClose={() => {}} />,
    )
    fireEvent.click(screen.getByTestId("shop-buy-lightning_bolt"))
    expect(conn.sendShopPurchase).toHaveBeenCalledWith("lightning_bolt")
  })

  it("clicking assign slot calls sendAssignAbility with id + slotIndex", () => {
    const conn = makeConnection()
    const state = makeState({ items: [{ itemId: "lightning_bolt" }] })
    render(<ShopModal shopState={state} connection={conn} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId("shop-assign-lightning_bolt"))
    fireEvent.click(screen.getByTestId("shop-assign-lightning_bolt-slot-2"))
    expect(conn.sendAssignAbility).toHaveBeenCalledWith("lightning_bolt", 2)
  })

  it("closes on Esc", () => {
    const onClose = vi.fn()
    render(
      <ShopModal
        shopState={makeState()}
        connection={makeConnection()}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })

  it("does NOT close on B (B is owned by LobbyGameHost toggle)", () => {
    const onClose = vi.fn()
    render(
      <ShopModal
        shopState={makeState()}
        connection={makeConnection()}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(window, { key: "b" })
    expect(onClose).not.toHaveBeenCalled()
  })

  it("marks already-owned non-stackable augments as Equipped", () => {
    const state = makeState({
      items: [{ itemId: "swift_boots" }],
      augmentItemIds: ["swift_boots"],
    })
    render(
      <ShopModal
        shopState={state}
        connection={makeConnection()}
        onClose={() => {}}
      />,
    )
    const article = screen.getByTestId("shop-item-swift_boots")
    expect(article.textContent).toContain("Equipped")
  })
})
