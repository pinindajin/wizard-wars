"use client"

import type { QuickItemSlot } from "@/shared/types"
import {
  useGameKeybinds,
  type GameKeybindActionId,
} from "./GameKeybindContext"

const QUICK_KEYBINDS: GameKeybindActionId[] = [
  "quick_item_1",
  "quick_item_2",
  "quick_item_3",
  "quick_item_4",
]

function formatHotkeyLabel(key: string): string {
  if (!key) return "—"
  if (key.length === 1) return key.toUpperCase()
  return key
}

/** Props for QuickItemBar. */
type QuickItemBarProps = {
  /** Array of 4 quick-item slot states. */
  readonly slots: readonly QuickItemSlot[]
}

/**
 * Quick-item bar: four slots with hotkey labels from the lobby keybind config.
 * Use is sent via Phaser `PlayerInput.useQuickItemSlot` (no React key handlers).
 *
 * @param props - QuickItemBarProps.
 */
export default function QuickItemBar({ slots }: QuickItemBarProps) {
  const keybinds = useGameKeybinds()

  return (
    <div className="flex items-end gap-2">
      {slots.map((slot, idx) => (
        <QuickItemSlotCell
          key={idx}
          hotkey={formatHotkeyLabel(keybinds[QUICK_KEYBINDS[idx]!] ?? "")}
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

        {!isEmpty && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-yellow-600 px-1 text-center text-xs font-bold leading-tight text-black">
            {charges}
          </span>
        )}
      </div>

      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
        {hotkey}
      </span>
    </div>
  )
}
