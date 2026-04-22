/**
 * Returns the tRPC API URL for the client-side HTTP batch link.
 *
 * @returns The tRPC endpoint path.
 */
export const getApiUrl = (): string => {
  return process.env.NEXT_PUBLIC_API_URL || "/api/trpc"
}

/**
 * Returns the Colyseus HTTP base URL for the SDK Client constructor.
 * SSR-safe: returns empty string when window is not available.
 *
 * @returns HTTP(S) origin URL string.
 */
export const getColyseusUrl = (): string => {
  const envUrl = process.env.NEXT_PUBLIC_COLYSEUS_URL
  if (envUrl) {
    const t = envUrl.trim()
    if (t.startsWith("ws://")) return `http://${t.slice(5)}`
    if (t.startsWith("wss://")) return `https://${t.slice(6)}`
    return t
  }
  if (typeof window === "undefined") return ""
  const protocol = window.location.protocol === "https:" ? "https:" : "http:"
  return `${protocol}//${window.location.host}`
}
