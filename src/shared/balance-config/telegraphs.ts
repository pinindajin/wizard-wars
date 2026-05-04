/** Fill color used while a combat telegraph is in its dangerous window. */
export const TELEGRAPH_DANGER_FILL_COLOR = 0xef4444

/**
 * Ground telegraph fill alpha during the dangerous window (Phaser 0–1; ~30% opacity).
 */
export const TELEGRAPH_DANGER_FILL_ALPHA = 0.3

/**
 * Lighter red fill for the pre-danger wind-up (after `startsAtServerTimeMs`, before `dangerStartsAtServerTimeMs`).
 * Same hue family as danger fill, lower contrast on screen.
 */
export const TELEGRAPH_WINDUP_FILL_COLOR = 0xfca5a5

/** Ground telegraph fill alpha during the wind-up window (Phaser 0–1). */
export const TELEGRAPH_WINDUP_FILL_ALPHA = 0.28

/** Milliseconds before Lightning Bolt effect time to show danger styling. */
export const LIGHTNING_TELEGRAPH_DANGER_LEAD_MS = 120
