/**
 * Whether the global lobby should show dev-only entry points for this username.
 * Match is case-insensitive: name starts with `dev` or ends with `dev`.
 *
 * @param username - Stored/display username from auth.
 * @returns True when dev tools UI may be shown.
 */
export function usernameHasDevToolsAccess(username: string): boolean {
  const u = username.trim().toLowerCase()
  if (u.length === 0) return false
  return u.startsWith("dev") || u.endsWith("dev")
}
