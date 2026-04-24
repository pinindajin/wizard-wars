"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createTrpcClient } from "@/lib/trpc"
import { DEFAULT_BGM_VOLUME, DEFAULT_SFX_VOLUME } from "@/shared/balance-config/audio"
import {
  GAME_KEYBIND_ACTION_IDS,
  GAME_KEYBIND_LABELS,
  DEFAULT_KEYBINDS,
  useGameKeybindContext,
  type GameKeybindActionId,
  type KeybindConfig,
} from "./GameKeybindContext"

/** Combat numbers display modes. */
const COMBAT_NUMBERS_MODES = ["OFF", "ON", "ON_EXTENDED", "ON_FULL"] as const
type CombatNumbersMode = (typeof COMBAT_NUMBERS_MODES)[number]

const COMBAT_NUMBERS_LABELS: Record<CombatNumbersMode, string> = {
  OFF: "Off",
  ON: "On",
  ON_EXTENDED: "On (Extended)",
  ON_FULL: "On (Full)",
}

/** Props for GameSettingsModal. */
type GameSettingsModalProps = {
  /** Called when the modal should close. */
  readonly onClose: () => void
  /** When true, show a host-only “End match” action. */
  readonly isHost?: boolean
  /** Invoked when the host ends the in-progress match. */
  readonly onEndMatch?: () => void
}

/**
 * Formats a key string for display (capitalises first letter).
 *
 * @param key - Raw key string from KeybindConfig.
 * @returns Display-friendly key label.
 */
function formatKey(key: string): string {
  if (!key) return "—"
  if (key.length === 1) return key.toUpperCase()
  return key
}

/**
 * In-game settings modal opened by the Backslash key.
 * Allows:
 *   - Keybind re-assignment for all GameKeybindActionIds
 *   - combatNumbersMode selector
 *   - BGM volume slider (0–100)
 *   - SFX volume slider (0–100)
 * Settings are saved via the `user.updateSettings` tRPC mutation.
 *
 * @param props - GameSettingsModalProps.
 */
export default function GameSettingsModal({
  onClose,
  isHost = false,
  onEndMatch,
}: GameSettingsModalProps) {
  const { keybinds, setKeybinds } = useGameKeybindContext()

  const [localKeybinds, setLocalKeybinds] = useState<KeybindConfig>({ ...keybinds })
  const [rebinding, setRebinding] = useState<GameKeybindActionId | null>(null)
  const [combatMode, setCombatMode] = useState<CombatNumbersMode>("ON")
  const [bgmVolume, setBgmVolume] = useState(DEFAULT_BGM_VOLUME)
  const [sfxVolume, setSfxVolume] = useState(DEFAULT_SFX_VOLUME)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const rebindingRef = useRef<GameKeybindActionId | null>(null)

  // Keep ref in sync for the keydown listener closure
  useEffect(() => {
    rebindingRef.current = rebinding
  }, [rebinding])

  // Load current settings from server on mount
  useEffect(() => {
    async function load() {
      try {
        const trpc = createTrpcClient()
        const { user } = await trpc.user.me.query()
        if (!user) return
        if (user.bgmVolume !== undefined && user.bgmVolume !== null) setBgmVolume(user.bgmVolume)
        if (user.sfxVolume !== undefined && user.sfxVolume !== null) setSfxVolume(user.sfxVolume)
        const mode = user.combatNumbersMode as CombatNumbersMode | null
        if (mode && COMBAT_NUMBERS_MODES.includes(mode)) setCombatMode(mode)
      } catch {
        // Use defaults
      }
    }
    void load()
  }, [])

  // Close on Escape key
  useEffect(() => {
    /** Handles Escape to close modal (unless capturing a rebind). */
    const onKey = (e: KeyboardEvent) => {
      if (rebindingRef.current) {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === "Escape") {
          setRebinding(null)
          return
        }
        // Capture the new key
        const newKey = e.key === " " ? "Space" : e.key
        setLocalKeybinds((prev) => ({
          ...prev,
          [rebindingRef.current!]: newKey,
        }))
        setRebinding(null)
        return
      }
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [onClose])

  /**
   * Saves the current settings to the server via tRPC mutation.
   */
  const save = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    setSavedOk(false)
    try {
      const trpc = createTrpcClient()
      await trpc.user.updateSettings.mutate({
        combatNumbersMode: combatMode,
        bgmVolume,
        sfxVolume,
        openSettingsKey: localKeybinds.open_settings,
      })
      setKeybinds(localKeybinds)
      setSavedOk(true)
      setTimeout(() => setSavedOk(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }, [combatMode, bgmVolume, sfxVolume, localKeybinds, setKeybinds])

  /**
   * Resets all keybinds to their defaults.
   */
  const resetKeybinds = useCallback(() => {
    setLocalKeybinds({ ...DEFAULT_KEYBINDS })
  }, [])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <h2 className="text-xl font-bold text-white">Game Settings</h2>
          <button
            className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
            onClick={onClose}
            type="button"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-4 space-y-8">
          {/* Audio section */}
          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-purple-400">
              Audio
            </h3>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <label
                  className="w-24 text-sm text-gray-300"
                  htmlFor="bgm-volume"
                >
                  BGM Volume
                </label>
                <input
                  id="bgm-volume"
                  className="flex-1 accent-purple-500"
                  type="range"
                  min={0}
                  max={100}
                  value={bgmVolume}
                  onChange={(e) => setBgmVolume(Number(e.target.value))}
                />
                <span className="w-10 text-right text-sm tabular-nums text-gray-300">
                  {bgmVolume}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <label
                  className="w-24 text-sm text-gray-300"
                  htmlFor="sfx-volume"
                >
                  SFX Volume
                </label>
                <input
                  id="sfx-volume"
                  className="flex-1 accent-purple-500"
                  type="range"
                  min={0}
                  max={100}
                  value={sfxVolume}
                  onChange={(e) => setSfxVolume(Number(e.target.value))}
                />
                <span className="w-10 text-right text-sm tabular-nums text-gray-300">
                  {sfxVolume}
                </span>
              </div>
            </div>
          </section>

          {/* Combat numbers section */}
          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-purple-400">
              Combat Numbers
            </h3>
            <div className="flex flex-wrap gap-2">
              {COMBAT_NUMBERS_MODES.map((mode) => (
                <button
                  key={mode}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    combatMode === mode
                      ? "bg-purple-600 text-white"
                      : "border border-gray-600 text-gray-400 hover:bg-gray-700"
                  }`}
                  onClick={() => setCombatMode(mode)}
                  type="button"
                >
                  {COMBAT_NUMBERS_LABELS[mode]}
                </button>
              ))}
            </div>
          </section>

          {/* Keybinds section */}
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-purple-400">
                Keybinds
              </h3>
              <button
                className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-400 hover:bg-gray-700"
                onClick={resetKeybinds}
                type="button"
              >
                Reset to Defaults
              </button>
            </div>
            <div className="space-y-1">
              {GAME_KEYBIND_ACTION_IDS.map((actionId) => {
                const isCapturing = rebinding === actionId
                return (
                  <div
                    key={actionId}
                    className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-gray-800"
                  >
                    <span className="text-sm text-gray-300">
                      {GAME_KEYBIND_LABELS[actionId]}
                    </span>
                    <button
                      className={`min-w-[80px] rounded border px-3 py-1 text-sm font-mono transition-colors ${
                        isCapturing
                          ? "animate-pulse border-purple-500 bg-purple-900/40 text-purple-300"
                          : "border-gray-600 bg-gray-800 text-gray-200 hover:border-gray-500"
                      }`}
                      onClick={() => setRebinding(isCapturing ? null : actionId)}
                      type="button"
                      title="Click then press a key to rebind"
                    >
                      {isCapturing ? "Press key…" : formatKey(localKeybinds[actionId])}
                    </button>
                  </div>
                )
              })}
            </div>
            {rebinding && (
              <p className="mt-2 text-center text-xs text-gray-500">
                Press any key to bind it · Escape to cancel
              </p>
            )}
          </section>

          {isHost && onEndMatch && (
            <section className="border-t border-gray-800 pt-6">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-500/90">
                Host
              </h3>
              <p className="mb-3 text-sm text-gray-400">
                End the match for all players. The final scoreboard will list “Match
                ended by host.”
              </p>
              <button
                type="button"
                className="rounded-md border border-red-700/80 bg-red-950/50 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-900/50"
                onClick={() => onEndMatch()}
              >
                End match
              </button>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-gray-700 bg-gray-900 px-6 py-4">
          {saveError && (
            <p className="text-xs text-red-400">{saveError}</p>
          )}
          {savedOk && (
            <p className="text-xs text-green-400">✓ Settings saved</p>
          )}
          {!saveError && !savedOk && <span />}
          <div className="flex gap-3">
            <button
              className="rounded-md border border-gray-600 px-4 py-2 text-sm text-gray-400 hover:bg-gray-700"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
              onClick={() => void save()}
              disabled={saving}
              type="button"
            >
              {saving ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
