/**
 * Fetches the session JWT for Colyseus WebSocket joins.
 *
 * `ww-token` is HttpOnly, so client code cannot read it from `document.cookie`.
 * This uses a same-origin route that reads the cookie server-side.
 *
 * @returns The JWT string, or `null` when unauthenticated or on network error.
 */
export async function fetchWsAuthToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/ws-token", {
      credentials: "include",
      cache: "no-store",
    })
    if (!res.ok) return null
    const data = (await res.json()) as { token?: unknown }
    return typeof data.token === "string" ? data.token : null
  } catch {
    return null
  }
}
