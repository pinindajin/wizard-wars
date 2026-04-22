/**
 * Shared runtime constants not belonging to a specific balance-config module.
 */

/** Maximum chat messages retained in the global /home chat buffer. */
export const CHAT_HISTORY_MAX_MESSAGES = 100

/** Maximum messages shown to a newly joining client. */
export const CHAT_HISTORY_SHOWN_ON_JOIN = 50

/** Chat rate limit: messages per window. */
export const CHAT_RATE_LIMIT_COUNT = 3

/** Chat rate limit window in ms. */
export const CHAT_RATE_LIMIT_WINDOW_MS = 5000

/** Maximum chat message length in characters. */
export const CHAT_MAX_MESSAGE_LENGTH = 200
