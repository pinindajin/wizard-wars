/**
 * Phaser registry key for the shared Colyseus `GameConnection` injected from React.
 * Arena reads this in `_openConnection` to avoid a second `joinById`.
 */
export const WW_GAME_CONNECTION_REGISTRY_KEY = "wwGameConnection"

/**
 * Phaser registry key for the authenticated user's id (JWT `sub`), used to tag the
 * local player for input / camera. Set from React via `mountGame` / `createGame`.
 */
export const WW_LOCAL_PLAYER_ID_REGISTRY_KEY = "wwLocalPlayerId"

/**
 * Injected `KeybindConfig` from React (GameSettingsProvider). KeyboardController
 * reads this so Phaser uses the same binds as the settings UI.
 */
export const WW_KEYBIND_CONFIG_REGISTRY_KEY = "wwKeybindConfig"

/**
 * Phaser registry key set by React while an in-game modal owns input.
 * KeyboardController and MouseController return inactive payloads when true.
 */
export const WW_GAMEPLAY_INPUT_BLOCKED_REGISTRY_KEY = "wwGameplayInputBlocked"

/**
 * Phaser registry key for local-only arena debug overlays.
 * React settings own this in memory; no network or persisted settings use it.
 */
export const WW_DEBUG_MODE_REGISTRY_KEY = "wwDebugMode"

/**
 * Phaser registry key for the loader status bridge. React components subscribe
 * via {@link subscribeLoaderStatus} to render a progress overlay outside the
 * Phaser canvas. Scenes publish via {@link publishLoaderStatus} in their
 * preload hooks and on completion.
 */
export const WW_LOADER_STATUS_REGISTRY_KEY = "wwLoaderStatus"
