/** Header set by Edge middleware so Node layouts can preserve the original path. */
export const PROTECTED_PATHNAME_HEADER = "x-ww-pathname"

/**
 * Returns a same-origin relative path safe for use as a login `next` target.
 *
 * @param value - Candidate next path.
 * @param fallback - Safe fallback path.
 * @returns Sanitized relative path.
 */
export function sanitizeRelativeNext(value: string | null | undefined, fallback = "/home"): string {
  if (!value) return fallback
  if (!value.startsWith("/") || value.startsWith("//")) return fallback
  try {
    const parsed = new URL(value, "http://wizard-wars.local")
    if (parsed.origin !== "http://wizard-wars.local") return fallback
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return fallback
  }
}

/**
 * Builds the auth cleanup route for an expired/stale session.
 *
 * @param nextPath - Relative path the user should return to after login.
 * @returns Session-expired API path.
 */
export function buildSessionExpiredPath(nextPath: string): string {
  const params = new URLSearchParams({ next: sanitizeRelativeNext(nextPath) })
  return `/api/auth/session-expired?${params.toString()}`
}

/**
 * Builds the login path used after clearing an expired/stale session.
 *
 * @param nextPath - Relative path the user should return to after login.
 * @returns Login path with reason and safe next params.
 */
export function buildSessionExpiredLoginPath(nextPath: string | null | undefined): string {
  const params = new URLSearchParams({
    next: sanitizeRelativeNext(nextPath),
    reason: "session-expired",
  })
  return `/login?${params.toString()}`
}
