"use client"

import { useEffect, useState } from "react"
import type { Room } from "@colyseus/sdk"
import { ABILITY_CONFIGS } from "@/shared/balance-config/abilities"
import { RoomEvent } from "@/shared/roomEvents"
import { useGameKeybinds } from "./GameKeybindContext"

/** Hotkey labels for ability slots 0-4. */
const HOTKEYS = ["1", "2", "3", "4", "5"] as const

/** Props for AbilityBar. */
type AbilityBarProps = {
  /**
   * Array of 5 ability slot values. Each element is an ability ID string
   * or null if the slot is empty.
   */
  readonly slots: readonly (string | null)[]
  /** Active Colyseus room used to send ability cast messages. */
  readonly room: Room | null
}

/**
 * Tracks per-slot cooldown end timestamps.
 */
type CooldownState = Record<number, number>

/**
 * Ability bar displaying 5 ability slots (hotkeys 1-5).
 * Shows ability icons, empty-slot placeholders, and cooldown radial sweeps.
 * Binds hotkeys 1-5 to fire the corresponding slot (respects Input Focus Lock).
 *
 * @param props - AbilityBarProps.
 */
export default function AbilityBar({ slots, room }: AbilityBarProps) {
  const [cooldowns, setCooldowns] = useState<CooldownState>({})
  const [now, setNow] = useState(() => Date.now())
  const keybinds = useGameKeybinds()

  // Keep 'now' updated for cooldown displays
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [])

  // Register hotkey listeners 1-5
  useEffect(() => {
    /** Fires the ability in the given slot index via the room. */
    function fire(slotIndex: number) {
      if (!room) return
      room.send(RoomEvent.PlayerInput, { abilitySlot: slotIndex })
      const abilityId = slots[slotIndex]
      if (!abilityId) return
      const config = ABILITY_CONFIGS[abilityId]
      if (!config) return
      const endMs = Date.now() + config.cooldownMs + config.castMs
      setCooldowns((prev) => ({ ...prev, [slotIndex]: endMs }))
    }

    /**
     * Handles global keydown events for ability hotkeys 1-5.
     * Respects Input Focus Lock: disabled when any input/textarea is focused.
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
      const idx = parseInt(e.key, 10) - 1
      if (idx >= 0 && idx <= 4) fire(idx)
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [room, slots, keybinds])

  return (
    <div className="flex items-end gap-2">
      {slots.map((abilityId, idx) => {
        const config = abilityId ? ABILITY_CONFIGS[abilityId] : null
        const cooldownEnd = cooldowns[idx] ?? 0
        const remainingMs = Math.max(0, cooldownEnd - now)
        const config2 = config
        const totalMs = config2 ? config2.cooldownMs + config2.castMs : 1
        const fraction = remainingMs / totalMs

        return (
          <AbilitySlot
            key={idx}
            hotkey={HOTKEYS[idx]}
            abilityName={config?.displayName ?? null}
            cooldownFraction={fraction}
            isEmpty={!abilityId}
          />
        )
      })}
    </div>
  )
}

/** Props for an individual ability slot. */
type AbilitySlotProps = {
  readonly hotkey: string
  readonly abilityName: string | null
  readonly cooldownFraction: number
  readonly isEmpty: boolean
}

/**
 * Single ability slot UI cell.
 * Renders the ability icon (or empty state), a cooldown radial sweep overlay,
 * and the hotkey label.
 *
 * @param props - AbilitySlotProps.
 */
function AbilitySlot({
  hotkey,
  abilityName,
  cooldownFraction,
  isEmpty,
}: AbilitySlotProps) {
  const r = 22
  const circumference = 2 * Math.PI * r
  const dashOffset = circumference * (1 - cooldownFraction)

  return (
    <div className="relative flex flex-col items-center gap-1">
      {/* Slot box */}
      <div
        className={`relative flex h-14 w-14 items-center justify-center rounded-lg border text-xs font-bold ${
          isEmpty
            ? "border-gray-700 bg-gray-900/60 text-gray-700"
            : "border-purple-600 bg-gray-900/80 text-white"
        }`}
      >
        {/* Ability icon (text placeholder) */}
        <span className="text-center text-xs leading-tight px-1">
          {isEmpty ? "—" : abilityName?.slice(0, 4) ?? "?"}
        </span>

        {/* Cooldown radial sweep SVG */}
        {cooldownFraction > 0 && (
          <svg
            className="absolute inset-0 -rotate-90"
            width="56"
            height="56"
            viewBox="0 0 56 56"
            aria-hidden="true"
          >
            <circle
              cx="28"
              cy="28"
              r={r}
              fill="none"
              stroke="rgba(0,0,0,0.7)"
              strokeWidth="4"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>

      {/* Hotkey label */}
      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
        {hotkey}
      </span>
    </div>
  )
}
