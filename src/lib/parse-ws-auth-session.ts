/**
 * Parsed body of GET `/api/auth/ws-token` when the session is valid.
 * Matches server fields returned after `verifyToken`.
 */
export type WsAuthSession = {
  readonly token: string
  readonly sub: string
  readonly username: string
}

/**
 * Validates JSON from `/api/auth/ws-token` (200) into a `WsAuthSession`.
 * Rejects empty strings so malformed or partial responses do not reach Colyseus.
 *
 * @param data - Parsed `res.json()` value.
 * @returns Session fields when shape is valid; otherwise `null`.
 */
export function parseWsAuthSessionPayload(data: unknown): WsAuthSession | null {
  if (data === null || typeof data !== "object") return null
  const rec = data as Record<string, unknown>
  const token = rec.token
  const sub = rec.sub
  const username = rec.username
  if (typeof token !== "string" || token.length === 0) return null
  if (typeof sub !== "string" || sub.length === 0) return null
  if (typeof username !== "string" || username.length === 0) return null
  return { token, sub, username }
}
