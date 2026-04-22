/** Server simulation tick rate in Hz. */
export const TICK_RATE_HZ = 20
/** Duration of one simulation tick in seconds. */
export const TICK_DT_SEC = 1 / TICK_RATE_HZ
/** Duration of one simulation tick in milliseconds. */
export const TICK_MS = 1000 / TICK_RATE_HZ

/** Adaptive EMA for client interpolation: alpha factor. */
export const INTERP_EMA_ALPHA = 0.2
/** Distance threshold above which the client teleports instead of interpolating. */
export const TELEPORT_THRESHOLD_PX = 200

/** Base tile size in pixels (also used for all asset sprites). */
export const BASE_TILE_SIZE_PX = 64

/** Y-sort depth offset: tilemap layer rendered behind everything at -1000. */
export const TILEMAP_DEPTH = -1000
