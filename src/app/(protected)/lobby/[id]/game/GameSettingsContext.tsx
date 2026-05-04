"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { useRouter } from "next/navigation"

import { createTrpcClient } from "@/lib/trpc"
import { isUnauthorizedTrpcError } from "@/lib/trpcErrors"
import { DEFAULT_BGM_VOLUME, DEFAULT_SFX_VOLUME } from "@/shared/balance-config/audio"
import {
  DEFAULT_MINIMAP_CORNER,
  MINIMAP_CORNERS,
  parseMinimapCorner,
  type MinimapCorner,
} from "@/shared/settings-config"
import {
  DEFAULT_KEYBINDS,
  GAME_KEYBIND_ACTION_IDS,
  type GameKeybindActionId,
  type KeybindConfig,
} from "@/shared/gameKeybinds/lobbyKeybinds"

export {
  DEFAULT_KEYBINDS,
  GAME_KEYBIND_ACTION_IDS,
  type GameKeybindActionId,
  type KeybindConfig,
}

/** Combat numbers display modes. */
export const COMBAT_NUMBERS_MODES = ["OFF", "ON", "ON_EXTENDED", "ON_FULL"] as const
export type CombatNumbersMode = (typeof COMBAT_NUMBERS_MODES)[number]

/** Default combat numbers display mode used before persisted settings load. */
export const DEFAULT_COMBAT_NUMBERS_MODE: CombatNumbersMode = "ON"

/** Human-readable display names for each action. */
export const GAME_KEYBIND_LABELS: Record<GameKeybindActionId, string> = {
  move_up: "Move Up",
  move_down: "Move Down",
  move_left: "Move Left",
  move_right: "Move Right",
  ability_1: "Ability Slot 1",
  ability_2: "Ability Slot 2",
  ability_3: "Ability Slot 3",
  ability_4: "Ability Slot 4",
  ability_5: "Ability Slot 5",
  quick_item_1: "Quick Item (Q)",
  quick_item_2: "Quick Item 2",
  quick_item_3: "Quick Item 3",
  quick_item_4: "Quick Item 4",
  open_settings: "Open Settings",
  scoreboard: "Scoreboard (hold)",
  toggle_minimap: "Toggle Minimap",
  weapon_primary: "Primary Attack",
  weapon_secondary: "Secondary Attack",
}

export {
  DEFAULT_MINIMAP_CORNER,
  MINIMAP_CORNERS,
  type MinimapCorner,
}

/** Audio volume settings in user-facing 0-100 units. */
export type AudioVolumeSettings = {
  readonly bgmVolume: number
  readonly sfxVolume: number
}

/** Shape of the in-game settings context value. */
type GameSettingsContextValue = {
  /** Current keybind config. */
  readonly keybinds: KeybindConfig
  /** Replace the full keybind config. */
  readonly setKeybinds: (config: KeybindConfig) => void
  /** Current audio volumes. */
  readonly audioVolumes: AudioVolumeSettings
  /** Replace audio volumes. */
  readonly setAudioVolumes: (settings: AudioVolumeSettings) => void
  /** Current combat numbers display mode. */
  readonly combatNumbersMode: CombatNumbersMode
  /** Replace combat numbers display mode. */
  readonly setCombatNumbersMode: (mode: CombatNumbersMode) => void
  /** Compact minimap screen corner. */
  readonly minimapCorner: MinimapCorner
  /** Replace compact minimap screen corner. */
  readonly setMinimapCorner: (corner: MinimapCorner) => void
  /** Current local-only debug overlay mode. */
  readonly debugModeEnabled: boolean
  /** Replace local-only debug overlay mode. */
  readonly setDebugModeEnabled: (enabled: boolean) => void
  /** True once the initial settings load has either succeeded or failed. */
  readonly settingsLoaded: boolean
  /** Non-auth settings load error, if defaults are being used. */
  readonly settingsLoadError: string | null
}

const GameSettingsContext = createContext<GameSettingsContextValue | null>(null)

/**
 * Returns the current relative URL for login return flow.
 *
 * @returns Current path and search, or `/home` when unavailable.
 */
function currentRelativePath(): string {
  if (typeof window === "undefined") return "/home"
  return `${window.location.pathname}${window.location.search}`
}

/**
 * Redirects the browser to login after an expired session.
 *
 * @param router - Next.js client router.
 */
function redirectToSessionExpired(router: ReturnType<typeof useRouter>): void {
  const params = new URLSearchParams({ next: currentRelativePath() })
  router.replace(`/api/auth/session-expired?${params.toString()}`)
}

/**
 * Provider that loads persisted game settings once and exposes them to HUD/settings components.
 *
 * @param props.children - React children.
 */
export function GameSettingsProvider({ children }: { readonly children: React.ReactNode }) {
  const router = useRouter()
  const [keybinds, setKeybinds] = useState<KeybindConfig>(DEFAULT_KEYBINDS)
  const [audioVolumes, setAudioVolumes] = useState<AudioVolumeSettings>({
    bgmVolume: DEFAULT_BGM_VOLUME,
    sfxVolume: DEFAULT_SFX_VOLUME,
  })
  const [combatNumbersMode, setCombatNumbersMode] =
    useState<CombatNumbersMode>(DEFAULT_COMBAT_NUMBERS_MODE)
  const [minimapCorner, setMinimapCorner] =
    useState<MinimapCorner>(DEFAULT_MINIMAP_CORNER)
  const [debugModeEnabled, setDebugModeEnabled] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    /**
     * Loads current user settings from the server.
     */
    async function load() {
      try {
        const trpc = createTrpcClient()
        const { user } = await trpc.user.me.query()
        if (cancelled) return
        if (!user) return
        if (user.openSettingsKey) {
          setKeybinds((prev) => ({
            ...prev,
            open_settings: user.openSettingsKey ?? prev.open_settings,
          }))
        }
        setAudioVolumes({
          bgmVolume: user.bgmVolume ?? DEFAULT_BGM_VOLUME,
          sfxVolume: user.sfxVolume ?? DEFAULT_SFX_VOLUME,
        })
        const mode = user.combatNumbersMode as CombatNumbersMode | null
        if (mode && COMBAT_NUMBERS_MODES.includes(mode)) {
          setCombatNumbersMode(mode)
        }
        setMinimapCorner(parseMinimapCorner(user.minimapCorner))
      } catch (err) {
        if (cancelled) return
        if (isUnauthorizedTrpcError(err)) {
          redirectToSessionExpired(router)
          return
        }
        setSettingsLoadError("Could not load saved settings; using defaults.")
      } finally {
        if (!cancelled) setSettingsLoaded(true)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [router])

  /**
   * Replaces the full keybind config with a new one.
   *
   * @param config - The new keybind configuration.
   */
  const handleSetKeybinds = useCallback((config: KeybindConfig) => {
    setKeybinds(config)
  }, [])

  /**
   * Replaces audio volume settings.
   *
   * @param settings - New audio volumes.
   */
  const handleSetAudioVolumes = useCallback((settings: AudioVolumeSettings) => {
    setAudioVolumes(settings)
  }, [])

  /**
   * Replaces compact minimap corner.
   *
   * @param corner - New minimap corner.
   */
  const handleSetMinimapCorner = useCallback((corner: MinimapCorner) => {
    setMinimapCorner(corner)
  }, [])

  return (
    <GameSettingsContext.Provider
      value={{
        keybinds,
        setKeybinds: handleSetKeybinds,
        audioVolumes,
        setAudioVolumes: handleSetAudioVolumes,
        combatNumbersMode,
        setCombatNumbersMode,
        minimapCorner,
        setMinimapCorner: handleSetMinimapCorner,
        debugModeEnabled,
        setDebugModeEnabled,
        settingsLoaded,
        settingsLoadError,
      }}
    >
      {children}
    </GameSettingsContext.Provider>
  )
}

/**
 * Hook to access the full game settings context.
 *
 * @returns The full game settings context value.
 * @throws If called outside of a `GameSettingsProvider`.
 */
export function useGameSettingsContext(): GameSettingsContextValue {
  const ctx = useContext(GameSettingsContext)
  if (!ctx) {
    throw new Error("useGameSettingsContext must be used inside GameSettingsProvider")
  }
  return ctx
}

/**
 * Hook to access the current game keybind configuration.
 *
 * @returns The current keybind config.
 */
export function useGameKeybinds(): KeybindConfig {
  return useGameSettingsContext().keybinds
}

/**
 * Backward-compatible hook for keybind-specific consumers.
 *
 * @returns Keybind config and setter.
 */
export function useGameKeybindContext(): Pick<
  GameSettingsContextValue,
  "keybinds" | "setKeybinds"
> {
  const { keybinds, setKeybinds } = useGameSettingsContext()
  return { keybinds, setKeybinds }
}

export const GameKeybindProvider = GameSettingsProvider
