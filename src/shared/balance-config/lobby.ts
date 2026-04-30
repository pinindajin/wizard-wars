/** Maximum number of players per match. */
export const MAX_PLAYERS_PER_MATCH = 12

/** Minimum players required for the host to start a match. */
export const MIN_PLAYERS_PER_MATCH = 1

/** Pre-game countdown ticks (each tick = 1s). */
export const PRE_GAME_COUNTDOWN_SEC = 3

/** Seconds the scoreboard is shown before returning to lobby. */
export const SCOREBOARD_COUNTDOWN_SEC = 10

/** Reconnection grace window in ms after a player disconnects mid-match. */
export const RECONNECT_WINDOW_MS = 60_000

/** Total match countdown duration in ms (3-2-1-GO = 4 beats). */
export const MATCH_COUNTDOWN_DURATION_MS = 4000

/** Each individual countdown tick in ms. */
export const COUNTDOWN_TICK_MS = 1000

/** Loading overlay fade duration in ms after MatchGo. */
export const OVERLAY_FADE_MS = 300

/** Server waits this long for all clients to signal ClientSceneReady before kicking late loaders. */
export const CLIENT_READY_TIMEOUT_MS = 15000

/** Maximum match wall-clock duration in ms (30 minutes). */
export const MATCH_MAX_DURATION_MS = 1_800_000

/** Lobby auto-closes after this many ms of idle time. */
export const LOBBY_IDLE_TIMEOUT_MS = 300_000

/**
 * When remaining lobby idle time is at or below this threshold, the client
 * shows a red warning countdown (see `LobbyIdlePill`).
 */
export const LOBBY_IDLE_WARNING_THRESHOLD_MS = 60_000

/** Fade duration (ms) when exiting the green “Lobby AFK Time” preview pill. */
export const LOBBY_IDLE_INFO_FADE_MS = 500

/** Buffer of lobby chat messages retained for new joiners. */
export const LOBBY_CHAT_BUFFER_MAX = 50

/** WebSocket ping timeout in ms (idle kick). */
export const WS_PING_TIMEOUT_MS = 30_000

/** Brief grace period for lobby disposal on last-leave. */
export const LOBBY_DISPOSAL_GRACE_MS = 10_000
