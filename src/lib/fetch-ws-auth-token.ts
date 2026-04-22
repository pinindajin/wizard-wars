import { parseWsAuthSessionPayload, type WsAuthSession } from "./parse-ws-auth-session"

export type { WsAuthSession }

/**
 * Fetches verified session credentials for Colyseus WebSocket joins.
 *
 * `ww-token` is HttpOnly, so client code cannot read it from `document.cookie`.
 * This uses a same-origin route that reads the cookie server-side and returns
 * `token`, JWT `sub`, and `username` for lobby identity alignment.
 *
 * @returns Session fields when authenticated and response shape is valid; otherwise `null`.
 */
export async function fetchWsAuthSession(): Promise<WsAuthSession | null> {
  try {
    const res = await fetch("/api/auth/ws-token", {
      credentials: "include",
      cache: "no-store",
    })
    if (!res.ok) return null
    const data: unknown = await res.json()
    return parseWsAuthSessionPayload(data)
  } catch {
    return null
  }
}

/**
 * Fetches the session JWT for Colyseus WebSocket joins.
 *
 * Prefer `fetchWsAuthSession` when the client needs JWT `sub` (e.g. lobby host checks).
 *
 * @returns The JWT string, or `null` when unauthenticated or on network error.
 */
export async function fetchWsAuthToken(): Promise<string | null> {
  const session = await fetchWsAuthSession()
  return session?.token ?? null
}
