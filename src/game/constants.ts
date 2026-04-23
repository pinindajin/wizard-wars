/**
 * Phaser registry key for the shared Colyseus `GameConnection` injected from React.
 * Arena reads this in `_openConnection` to avoid a second `joinById`.
 */
export const WW_GAME_CONNECTION_REGISTRY_KEY = "wwGameConnection"
