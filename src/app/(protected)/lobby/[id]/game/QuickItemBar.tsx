"use client"

import { useEffect } from "react"
import type { Room } from "@colyseus/sdk"
import type { QuickItemSlot } from "@/shared/types"
import { RoomEvent } from "@/shared/roomEvents"
import { useGameKeybinds } from "./GameKeybindContext"

/** Display hotkey labels for quick-item slots 0-3. */
const QUICK_HOTKEYS = ["Q", "6", "7", "8"] as const

/** Props for QuickItemBar. */
type QuickItemBarProps = {
  /** Array of 4 quick-item slot states. */
  readonly slots: readonly QuickItemSlot[]
  /** Active Colyseus room used to send use-item messages. */
  readonly room: Room | null
}

/**
 * Quick-item bar displaying 4 slots with hotkeys Q, 6, 7, 8.
 * Shows item icon (text placeholder) and charge count.
 * Binds hotkeys to `UseQuickItem` room messages.
 * Respects Input Focus Lock when any input/textarea is focused.
 *
 * @param props - QuickItemBarProps.
 */
export default function QuickItemBar({ slots, room }: QuickItemBarProps) {
  const keybinds = useGameKeybinds()

  useEffect(() => {
    /**
     * Handles keydown events for quick-item hotkeys.
     * Input Focus Lock: disabled when any input/textarea is focused.
     *
     * @param e - The keyboard event.
     */
    function onKey(e: KeyboardEvent) {
      const active = document.activeElement
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      )
        return

      let slotIndex = -1
      const key = e.key.toLowerCase()
      if (key === "q") slotIndex = 0
      else if (key === "6") slotIndex = 1
      else if (key === "7") slotIndex = 2
      else if (key === "8") slotIndex = 3

      if (slotIndex < 0 || !room) return
      const slot = slots[slotIndex]
      if (!slot?.itemId || slot.charges <= 0) return
      room.send(RoomEvent.UseQuickItem, { slotIndex })
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [room, slots, keybinds])

  return (
    <div className="flex items-end gap-2">
      {slots.map((slot, idx) => (
        <QuickItemSlotCell
          key={idx}
          hotkey={QUICK_HOTKEYS[idx]}
          itemId={slot.itemId}
          charges={slot.charges}
        />
      ))}
    </div>
  )
}

/** Props for a single quick-item slot cell. */
type QuickItemSlotCellProps = {
  readonly hotkey: string
  readonly itemId: string | null
  readonly charges: number
}

/**
 * Single quick-item slot cell.
 * Shows the item icon (abbreviated text placeholder) and a charge badge.
 *
 * @param props - QuickItemSlotCellProps.
 */
function QuickItemSlotCell({ hotkey, itemId, charges }: QuickItemSlotCellProps) {
  const isEmpty = !itemId
  const depleted = !isEmpty && charges <= 0

  return (
    <div className="relative flex flex-col items-center gap-1">
      <div
        className={`relative flex h-12 w-12 items-center justify-center rounded-lg border text-xs font-bold ${
          isEmpty
            ? "border-gray-700 bg-gray-900/60 text-gray-700"
            : depleted
              ? "border-gray-600 bg-gray-900/60 text-gray-600 opacity-50"
              : "border-yellow-600 bg-gray-900/80 text-white"
        }`}
      >
        <span className="text-xs leading-tight text-center px-0.5">
          {isEmpty ? "—" : itemId.slice(0, 4)}
        </span>

        {/* Charge count badge */}
        {!isEmpty && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-yellow-600 px-1 text-center text-xs font-bold leading-tight text-black">
            {charges}
          </span>
        )}
      </div>

      {/* Hotkey label */}
      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
        {hotkey}
      </span>
    </div>
  )
}
