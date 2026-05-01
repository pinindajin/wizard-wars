"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createTrpcClient } from "@/lib/trpc"
import { isUnauthorizedTrpcError } from "@/lib/trpcErrors"
import {
  COMBAT_NUMBERS_MODES,
  GAME_KEYBIND_ACTION_IDS,
  GAME_KEYBIND_LABELS,
  DEFAULT_KEYBINDS,
  MINIMAP_CORNERS,
  useGameSettingsContext,
  type AudioVolumeSettings,
  type CombatNumbersMode,
  type GameKeybindActionId,
  type KeybindConfig,
  type MinimapCorner,
} from "./GameSettingsContext"
import { useBlockGameplayInputEvents } from "./useBlockGameplayInputEvents"

const COMBAT_NUMBERS_LABELS: Record<CombatNumbersMode, string> = {
  OFF: "Off",
  ON: "On",
  ON_EXTENDED: "On (Extended)",
  ON_FULL: "On (Full)",
}

const MINIMAP_CORNER_LABELS: Record<MinimapCorner, string> = {
  top_left: "Top Left",
  top_right: "Top Right",
  bottom_left: "Bottom Left",
  bottom_right: "Bottom Right",
}

/** Props for GameSettingsModal. */
type GameSettingsModalProps = {
  /** Called when the modal should close. */
  readonly onClose: () => void
  /** When true, show a host-only “End match” action. */
  readonly isHost?: boolean
  /** Invoked when the host ends the in-progress match. */
  readonly onEndMatch?: () => void
  /** Applies live audio preview values to Phaser. */
  readonly onApplyAudioVolumes: (settings: AudioVolumeSettings) => void
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
  onApplyAudioVolumes,
}: GameSettingsModalProps) {
  const router = useRouter()
  const gameplayInputBlockProps = useBlockGameplayInputEvents()
  const {
    keybinds,
    setKeybinds,
    audioVolumes,
    setAudioVolumes,
    combatNumbersMode,
    setCombatNumbersMode,
    minimapCorner,
    setMinimapCorner,
    debugModeEnabled,
    setDebugModeEnabled,
    settingsLoaded,
    settingsLoadError,
  } = useGameSettingsContext()

  const [localKeybinds, setLocalKeybinds] = useState<KeybindConfig>({ ...keybinds })
  const [rebinding, setRebinding] = useState<GameKeybindActionId | null>(null)
  const [combatMode, setCombatMode] = useState<CombatNumbersMode>(combatNumbersMode)
  const [localMinimapCorner, setLocalMinimapCorner] =
    useState<MinimapCorner>(minimapCorner)
  const [bgmVolume, setBgmVolume] = useState(audioVolumes.bgmVolume)
  const [sfxVolume, setSfxVolume] = useState(audioVolumes.sfxVolume)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const rebindingRef = useRef<GameKeybindActionId | null>(null)

  // Keep ref in sync for the keydown listener closure
  useEffect(() => {
    rebindingRef.current = rebinding
  }, [rebinding])

  /**
   * Redirects the user to login after a stale session response.
   */
  const redirectToSessionExpired = useCallback(() => {
    const next = `${window.location.pathname}${window.location.search}`
    const params = new URLSearchParams({ next })
    router.replace(`/api/auth/session-expired?${params.toString()}`)
  }, [router])

  /**
   * Closes the modal without saving and restores the live audio preview.
   */
  const cancel = useCallback(() => {
    onApplyAudioVolumes(audioVolumes)
    onClose()
  }, [audioVolumes, onApplyAudioVolumes, onClose])

  /**
   * Updates BGM volume local state and live audio preview.
   *
   * @param volume - New BGM volume in 0-100 units.
   */
  const changeBgmVolume = useCallback((volume: number) => {
    setBgmVolume(volume)
    onApplyAudioVolumes({ bgmVolume: volume, sfxVolume })
  }, [onApplyAudioVolumes, sfxVolume])

  /**
   * Updates SFX volume local state and live audio preview.
   *
   * @param volume - New SFX volume in 0-100 units.
   */
  const changeSfxVolume = useCallback((volume: number) => {
    setSfxVolume(volume)
    onApplyAudioVolumes({ bgmVolume, sfxVolume: volume })
  }, [bgmVolume, onApplyAudioVolumes])

  /**
   * Handles Escape to close modal (unless capturing a rebind).
   *
   * @param e - Keyboard event.
   */
  const onModalKey = useCallback((e: KeyboardEvent) => {
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
    if (e.key === "Escape") cancel()
  }, [cancel])

  // Close on Escape key
  useEffect(() => {
    window.addEventListener("keydown", onModalKey, { capture: true })
    return () => window.removeEventListener("keydown", onModalKey, { capture: true })
  }, [onModalKey])

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
        minimapCorner: localMinimapCorner,
      })
      setKeybinds(localKeybinds)
      setAudioVolumes({ bgmVolume, sfxVolume })
      setCombatNumbersMode(combatMode)
      setMinimapCorner(localMinimapCorner)
      setSavedOk(true)
      setTimeout(() => setSavedOk(false), 2000)
    } catch (err) {
      if (isUnauthorizedTrpcError(err)) {
        redirectToSessionExpired()
        return
      }
      setSaveError(err instanceof Error ? err.message : "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }, [
    bgmVolume,
    combatMode,
    localKeybinds,
    localMinimapCorner,
    redirectToSessionExpired,
    setAudioVolumes,
    setCombatNumbersMode,
    setKeybinds,
    setMinimapCorner,
    sfxVolume,
  ])

  /**
   * Resets all keybinds to their defaults.
   */
  const resetKeybinds = useCallback(() => {
    setLocalKeybinds({ ...DEFAULT_KEYBINDS })
  }, [])

  return (
    <div
      {...gameplayInputBlockProps}
      data-testid="settings-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) cancel()
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <h2 className="text-xl font-bold text-white">Game Settings</h2>
          <button
            className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
            onClick={cancel}
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
                  data-testid="settings-bgm-volume"
                  type="range"
                  min={0}
                  max={100}
                  value={bgmVolume}
                  onChange={(e) => changeBgmVolume(Number(e.target.value))}
                  disabled={!settingsLoaded}
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
                  data-testid="settings-sfx-volume"
                  type="range"
                  min={0}
                  max={100}
                  value={sfxVolume}
                  onChange={(e) => changeSfxVolume(Number(e.target.value))}
                  disabled={!settingsLoaded}
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

          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-purple-400">
              Minimap
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MINIMAP_CORNERS.map((corner) => (
                <button
                  key={corner}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    localMinimapCorner === corner
                      ? "border-purple-500 bg-purple-600 text-white"
                      : "border-gray-600 text-gray-400 hover:bg-gray-700"
                  }`}
                  data-testid={`settings-minimap-corner-${corner}`}
                  onClick={() => setLocalMinimapCorner(corner)}
                  type="button"
                >
                  {MINIMAP_CORNER_LABELS[corner]}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-purple-400">
              Debug
            </h3>
            <label className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-950/40 px-4 py-3">
              <span className="text-sm font-medium text-gray-200">
                Debug Mode
              </span>
              <input
                aria-label="Debug Mode"
                className="h-5 w-5 accent-purple-500"
                data-testid="settings-debug-mode"
                type="checkbox"
                checked={debugModeEnabled}
                onChange={(e) => setDebugModeEnabled(e.target.checked)}
              />
            </label>
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
          {!saveError && settingsLoadError && (
            <p className="text-xs text-amber-300">{settingsLoadError}</p>
          )}
          {savedOk && (
            <p className="text-xs text-green-400">✓ Settings saved</p>
          )}
          {!saveError && !settingsLoadError && !savedOk && <span />}
          <div className="flex gap-3">
            <button
              className="rounded-md border border-gray-600 px-4 py-2 text-sm text-gray-400 hover:bg-gray-700"
              onClick={cancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
              onClick={() => void save()}
              disabled={saving || !settingsLoaded}
              type="button"
              data-testid="settings-save"
            >
              {!settingsLoaded ? "Loading…" : saving ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
