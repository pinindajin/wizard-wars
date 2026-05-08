"use client"

import { ABILITY_CONFIGS } from "@/shared/balance-config/abilities"
import type { AbilityRuntimeState, AbilityRuntimeStates } from "@/shared/types"
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

/**
 * Formats a remaining cooldown duration as an MMO-style seconds number.
 *
 * @param remainingMs - Remaining duration in milliseconds.
 * @returns Ceiling seconds text, or null when no countdown should render.
 */
function formatCountdownLabel(remainingMs: number): string | null {
  if (remainingMs <= 0) return null
  return String(Math.max(1, Math.ceil(remainingMs / 1000)))
}

/**
 * Returns positive remaining milliseconds until a server-time deadline.
 *
 * @param endsAtServerTimeMs - Server-time deadline, or null.
 * @param serverNowMs - Estimated current server time.
 * @returns Remaining milliseconds, clamped at zero.
 */
function remainingMs(endsAtServerTimeMs: number | null | undefined, serverNowMs: number): number {
  if (endsAtServerTimeMs == null) return 0
  return Math.max(0, endsAtServerTimeMs - serverNowMs)
}

/**
 * Resolves visual cooldown state for a slot.
 *
 * @param state - Ability runtime state from the server.
 * @param serverNowMs - Estimated current server time.
 * @returns Overlay kind and countdown label for the slot.
 */
function resolveCooldownVisual(
  state: AbilityRuntimeState | undefined,
  serverNowMs: number,
): { kind: "heavy" | "light" | null; label: string | null } {
  const cooldownMs = remainingMs(state?.cooldownEndsAtServerTimeMs, serverNowMs)
  if (cooldownMs > 0) {
    return { kind: "heavy", label: formatCountdownLabel(cooldownMs) }
  }

  const rechargeMs = remainingMs(state?.rechargeEndsAtServerTimeMs, serverNowMs)
  if (rechargeMs > 0) {
    return { kind: "light", label: formatCountdownLabel(rechargeMs) }
  }

  return { kind: null, label: null }
}

/** Props for AbilityBar. */
type AbilityBarProps = {
  /**
   * Array of 5 ability slot values. Each element is an ability ID string
   * or null if the slot is empty.
   */
  readonly slots: readonly (string | null)[]
  /** Server-authoritative ability runtime state keyed by ability id. */
  readonly abilityStates?: AbilityRuntimeStates
  /** Estimated current server wall-clock time for countdown labels. */
  readonly serverNowMs: number
}

/**
 * Ability bar: five slots, hotkey labels from the lobby keybind config.
 * Ability casts are sent via Phaser `PlayerInput` only (no React key handlers).
 *
 * @param props - AbilityBarProps.
 */
export default function AbilityBar({
  slots,
  abilityStates = {},
  serverNowMs,
}: AbilityBarProps) {
  const keybinds = useGameKeybinds()

  return (
    <div className="flex items-end gap-2">
      {slots.map((abilityId, idx) => {
        const config = abilityId ? ABILITY_CONFIGS[abilityId] : null
        const runtimeState = abilityId ? abilityStates[abilityId] : undefined
        const hotkey = formatHotkeyLabel(keybinds[ABILITY_KEYBINDS[idx]!] ?? "")

        return (
          <AbilitySlot
            key={idx}
            index={idx}
            hotkey={hotkey}
            abilityName={config?.displayName ?? null}
            runtimeState={runtimeState}
            serverNowMs={serverNowMs}
            isEmpty={!abilityId}
          />
        )
      })}
    </div>
  )
}

/** Props for an individual ability slot. */
type AbilitySlotProps = {
  readonly index: number
  readonly hotkey: string
  readonly abilityName: string | null
  readonly runtimeState: AbilityRuntimeState | undefined
  readonly serverNowMs: number
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
  index,
  hotkey,
  abilityName,
  runtimeState,
  serverNowMs,
  isEmpty,
}: AbilitySlotProps) {
  const cooldown = resolveCooldownVisual(runtimeState, serverNowMs)
  const chargeCount = runtimeState?.charges

  return (
    <div className="relative flex flex-col items-center gap-1">
      {/* Slot box */}
      <div
        data-testid={`ability-slot-${index}`}
        className={`relative flex h-14 w-14 items-center justify-center rounded-lg border text-xs font-bold ${
          isEmpty
            ? "border-gray-700 bg-gray-900/60 text-gray-700"
            : "border-purple-600 bg-gray-900/80 text-white"
        }`}
      >
        <span className="z-10 text-center text-xs leading-tight px-1">
          {isEmpty ? "—" : abilityName?.slice(0, 4) ?? "?"}
        </span>

        {chargeCount != null && (
          <span
            className="absolute -right-1 -top-1 z-30 min-w-[18px] rounded-full bg-purple-200 px-1 text-center text-[11px] font-bold leading-tight text-purple-950"
            data-testid={`ability-slot-${index}-charge-count`}
          >
            {chargeCount}
          </span>
        )}

        {cooldown.kind && (
          <div
            className={`absolute inset-0 z-20 rounded-lg ${
              cooldown.kind === "heavy" ? "bg-black/75" : "bg-black/35"
            }`}
            data-cooldown-kind={cooldown.kind}
            data-testid={`ability-slot-${index}-cooldown-overlay`}
          />
        )}

        {cooldown.label && (
          <span
            className="absolute inset-0 z-30 flex items-center justify-center text-lg font-black leading-none text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
            data-testid={`ability-slot-${index}-cooldown-countdown`}
          >
            {cooldown.label}
          </span>
        )}
      </div>

      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
        {hotkey}
      </span>
    </div>
  )
}
