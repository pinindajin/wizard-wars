"use client"

import { ABILITY_CONFIGS } from "@/shared/balance-config/abilities"
import {
  useGameKeybinds,
  type GameKeybindActionId,
} from "./GameKeybindContext"

const ABILITY_KEYBINDS: GameKeybindActionId[] = [
  "ability_1",
  "ability_2",
  "ability_3",
  "ability_4",
  "ability_5",
]

/**
 * Formats a key string for a small hotkey label under each slot.
 */
function formatHotkeyLabel(key: string): string {
  if (!key) return "—"
  if (key.length === 1) return key.toUpperCase()
  return key
}

/** Props for AbilityBar. */
type AbilityBarProps = {
  /**
   * Array of 5 ability slot values. Each element is an ability ID string
   * or null if the slot is empty.
   */
  readonly slots: readonly (string | null)[]
}

/**
 * Ability bar: five slots, hotkey labels from the lobby keybind config.
 * Ability casts are sent via Phaser `PlayerInput` only (no React key handlers).
 *
 * @param props - AbilityBarProps.
 */
export default function AbilityBar({ slots }: AbilityBarProps) {
  const keybinds = useGameKeybinds()

  return (
    <div className="flex items-end gap-2">
      {slots.map((abilityId, idx) => {
        const config = abilityId ? ABILITY_CONFIGS[abilityId] : null
        const fraction = 0
        const hotkey = formatHotkeyLabel(keybinds[ABILITY_KEYBINDS[idx]!] ?? "")

        return (
          <AbilitySlot
            key={idx}
            hotkey={hotkey}
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
        <span className="text-center text-xs leading-tight px-1">
          {isEmpty ? "—" : abilityName?.slice(0, 4) ?? "?"}
        </span>

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

      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
        {hotkey}
      </span>
    </div>
  )
}
