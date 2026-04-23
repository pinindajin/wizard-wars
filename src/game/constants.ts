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
 * Phaser registry key for the loader status bridge. React components subscribe
 * via {@link subscribeLoaderStatus} to render a progress overlay outside the
 * Phaser canvas. Scenes publish via {@link publishLoaderStatus} in their
 * preload hooks and on completion.
 */
export const WW_LOADER_STATUS_REGISTRY_KEY = "wwLoaderStatus"
