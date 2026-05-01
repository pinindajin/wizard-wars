/**
 * Shared auth/session constants for JWT cookies and token lifetime.
 */

/** Cookie name for the JWT session; must match anywhere cookies are parsed. */
export const AUTH_COOKIE_NAME = "ww-token"
/** JWT `exp` duration string passed to jose. */
export const AUTH_TOKEN_EXPIRY = "7d"
/** `Max-Age` (seconds) on the Set-Cookie line; must align with AUTH_TOKEN_EXPIRY. */
export const AUTH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
