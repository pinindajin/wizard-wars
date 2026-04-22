"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { createTrpcClient } from "@/lib/trpc"

/**
 * All action IDs that can be rebound in the game settings modal.
 * Each entry is a stable key used for persistence and display.
 */
export const GAME_KEYBIND_ACTION_IDS = [
  "move_up",
  "move_down",
  "move_left",
  "move_right",
  "ability_1",
  "ability_2",
  "ability_3",
  "ability_4",
  "ability_5",
  "quick_item_1",
  "quick_item_2",
  "quick_item_3",
  "quick_item_4",
  "open_settings",
  "scoreboard",
  "weapon_primary",
  "weapon_secondary",
] as const

/** A single keybind action identifier. */
export type GameKeybindActionId = (typeof GAME_KEYBIND_ACTION_IDS)[number]

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
  weapon_primary: "Primary Attack",
  weapon_secondary: "Secondary Attack",
}

/** Default keybind assignments. */
export const DEFAULT_KEYBINDS: Record<GameKeybindActionId, string> = {
  move_up: "w",
  move_down: "s",
  move_left: "a",
  move_right: "d",
  ability_1: "1",
  ability_2: "2",
  ability_3: "3",
  ability_4: "4",
  ability_5: "5",
  quick_item_1: "q",
  quick_item_2: "6",
  quick_item_3: "7",
  quick_item_4: "8",
  open_settings: "\\",
  scoreboard: "Tab",
  weapon_primary: "MouseLeft",
  weapon_secondary: "MouseRight",
}

/** The keybind config map (action ID → key string). */
export type KeybindConfig = Record<GameKeybindActionId, string>

/** Shape of the GameKeybind context value. */
type GameKeybindContextValue = {
  /** Current keybind config. */
  readonly keybinds: KeybindConfig
  /** Replace the full keybind config. */
  readonly setKeybinds: (config: KeybindConfig) => void
}

const GameKeybindContext = createContext<GameKeybindContextValue | null>(null)

/**
 * Provider that loads keybinds from `user.me` on mount and exposes
 * them to all game HUD components.
 *
 * @param props.children - React children.
 */
export function GameKeybindProvider({ children }: { children: React.ReactNode }) {
  const [keybinds, setKeybinds] = useState<KeybindConfig>(DEFAULT_KEYBINDS)

  // Load persisted keybinds from the server on mount
  useEffect(() => {
    async function load() {
      try {
        const trpc = createTrpcClient()
        const { user } = await trpc.user.me.query()
        if (!user) return
        // `openSettingsKey` is the only persisted key for now;
        // extend here when more custom keybinds are stored server-side.
        if (user.openSettingsKey) {
          setKeybinds((prev) => ({
            ...prev,
            open_settings: user.openSettingsKey ?? prev.open_settings,
          }))
        }
      } catch {
        // Use defaults if fetch fails
      }
    }
    void load()
  }, [])

  /**
   * Replaces the full keybind config with a new one.
   *
   * @param config - The new keybind configuration.
   */
  const handleSet = useCallback((config: KeybindConfig) => {
    setKeybinds(config)
  }, [])

  return (
    <GameKeybindContext.Provider value={{ keybinds, setKeybinds: handleSet }}>
      {children}
    </GameKeybindContext.Provider>
  )
}

/**
 * Hook to access the current game keybind configuration.
 *
 * @returns The GameKeybind context value.
 * @throws If called outside of a `GameKeybindProvider`.
 */
export function useGameKeybinds(): KeybindConfig {
  const ctx = useContext(GameKeybindContext)
  if (!ctx) {
    throw new Error("useGameKeybinds must be used inside GameKeybindProvider")
  }
  return ctx.keybinds
}

/**
 * Hook to access both the keybind config and the setter.
 *
 * @returns The full GameKeybind context value.
 * @throws If called outside of a `GameKeybindProvider`.
 */
export function useGameKeybindContext(): GameKeybindContextValue {
  const ctx = useContext(GameKeybindContext)
  if (!ctx) {
    throw new Error("useGameKeybindContext must be used inside GameKeybindProvider")
  }
  return ctx
}
