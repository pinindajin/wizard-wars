"use client"

import { useEffect, useMemo, useState } from "react"

import { SHOP_ITEMS, type ShopItemCategory, type ShopItemConfig } from "@/shared/balance-config/items"
import { ABILITY_BAR_SLOT_COUNT } from "@/shared/balance-config/economy"
import type { ShopStatePayload } from "@/shared/types"
import type { GameConnection } from "@/game/network/GameConnection"
import { useBlockGameplayInputEvents } from "./useBlockGameplayInputEvents"

/** Ordered category tabs rendered in the modal. */
const CATEGORY_ORDER: readonly ShopItemCategory[] = ["ability", "augment", "consumable"]

/** Props for ShopModal. */
type ShopModalProps = {
  /** Current shop state from the server (gold / owned / slots). */
  readonly shopState: ShopStatePayload | null
  /** Layout-owned Colyseus adapter used to send shop messages. */
  readonly connection: GameConnection
  /** Invoked when the player closes the modal (Esc or toggle key). */
  readonly onClose: () => void
}

/**
 * In-match shop modal. Lists every `SHOP_ITEMS` entry grouped by category and
 * exposes buy / assign actions. Closes on `Esc` or `B` (the configured
 * `openShopModal` keybind) — `LobbyGameHost` also toggles via the same key.
 *
 * @param props - ShopModalProps.
 */
export default function ShopModal({ shopState, connection, onClose }: ShopModalProps) {
  const gameplayInputBlockProps = useBlockGameplayInputEvents()
  const gold = shopState?.gold ?? 0
  const ownedIds = useMemo(
    () => new Set((shopState?.items ?? []).map((i) => i.itemId)),
    [shopState?.items],
  )
  const abilitySlots = shopState?.abilitySlots ?? []
  const equippedAugmentIds = useMemo(
    () => new Set(shopState?.augmentItemIds ?? []),
    [shopState?.augmentItemIds],
  )
  const [assigning, setAssigning] = useState<string | null>(null)

  useEffect(() => {
    // Only `Escape` is owned by the modal itself. The `b` toggle is handled
    // by `LobbyGameHost` (single listener) so both open and close stay atomic.
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      ) {
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const grouped = useMemo(() => {
    const acc: Record<ShopItemCategory, ShopItemConfig[]> = {
      ability: [],
      augment: [],
      consumable: [],
    }
    for (const item of Object.values(SHOP_ITEMS)) {
      acc[item.category].push(item)
    }
    for (const cat of CATEGORY_ORDER) acc[cat].sort((a, b) => a.cost - b.cost)
    return acc
  }, [])

  return (
    <div
      {...gameplayInputBlockProps}
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Shop"
      data-testid="shop-modal"
    >
      <div className="w-full max-w-3xl rounded-2xl border border-white/[0.08] bg-[rgba(9,12,30,0.96)] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.7)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Shop</h2>
          <div className="flex items-center gap-4">
            <span
              className="font-mono tabular-nums text-yellow-300"
              data-testid="shop-gold"
            >
              🪙 {gold}
            </span>
            <button
              type="button"
              className="rounded border border-gray-600 px-3 py-1 text-sm text-gray-200 hover:bg-gray-800"
              data-testid="shop-close"
              onClick={onClose}
            >
              Close (B)
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto pr-1">
          {CATEGORY_ORDER.map((category) => {
            const items = grouped[category]
            if (items.length === 0) return null
            return (
              <section
                key={category}
                className="mb-6"
                data-testid={`shop-section-${category}`}
              >
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-purple-300">
                  {category}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {items.map((item) => {
                    const owned = ownedIds.has(item.id)
                    const canAfford = gold >= item.cost
                    const isEquippedAugment =
                      item.category === "augment" && equippedAugmentIds.has(item.id)
                    const canBuy = !owned && canAfford

                    return (
                      <article
                        key={item.id}
                        className="flex flex-col gap-2 rounded-lg border border-white/[0.08] bg-black/50 p-3"
                        data-testid={`shop-item-${item.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-white">{item.displayName}</p>
                            <p className="text-xs text-gray-400">{item.description}</p>
                          </div>
                          <span className="shrink-0 font-mono text-sm tabular-nums text-yellow-300">
                            {item.cost}g
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={!canBuy}
                            onClick={() => {
                              connection.sendShopPurchase(item.id)
                              if (item.category === "ability") {
                                setAssigning(item.id)
                              }
                            }}
                            className="rounded bg-purple-600 px-3 py-1 text-sm font-semibold text-white enabled:hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                            data-testid={`shop-buy-${item.id}`}
                          >
                            {owned ? "Owned" : canAfford ? "Buy" : "Not enough gold"}
                          </button>

                          {item.category === "ability" && owned && (
                            <button
                              type="button"
                              onClick={() => setAssigning(item.id)}
                              className="rounded border border-purple-500 px-3 py-1 text-sm text-purple-200 hover:bg-purple-900/50"
                              data-testid={`shop-assign-${item.id}`}
                            >
                              Assign slot
                            </button>
                          )}

                          {item.category === "augment" && isEquippedAugment && (
                            <span className="rounded border border-emerald-600/60 px-3 py-1 text-sm text-emerald-300">
                              Equipped
                            </span>
                          )}
                        </div>

                        {assigning === item.id && item.category === "ability" && (
                          <div
                            className="mt-2 flex flex-wrap gap-1"
                            data-testid={`shop-assign-picker-${item.id}`}
                          >
                            {Array.from({ length: ABILITY_BAR_SLOT_COUNT }).map(
                              (_, slotIdx) => {
                                const occupant = abilitySlots[slotIdx]
                                return (
                                  <button
                                    key={slotIdx}
                                    type="button"
                                    onClick={() => {
                                      connection.sendAssignAbility(item.id, slotIdx)
                                      setAssigning(null)
                                    }}
                                    className="rounded border border-purple-500/60 px-2 py-0.5 text-xs text-purple-100 hover:bg-purple-800/50"
                                    data-testid={`shop-assign-${item.id}-slot-${slotIdx}`}
                                  >
                                    {slotIdx + 1}
                                    {occupant ? ` (${occupant.slice(0, 4)})` : ""}
                                  </button>
                                )
                              },
                            )}
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
