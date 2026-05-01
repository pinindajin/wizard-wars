import { AUTH_COOKIE_NAME, AUTH_TOKEN_MAX_AGE_SECONDS } from "./constants"

/**
 * Builds `Set-Cookie` header values for the session token (HttpOnly, Lax, path `/`).
 */

/**
 * Builds a `Set-Cookie` header value for the session token (HttpOnly, Lax, path `/`).
 *
 * @param token - JWT string from `signToken`.
 * @returns Cookie header value with attributes.
 */
export const createAuthCookie = (token: string): string => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
  return `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_TOKEN_MAX_AGE_SECONDS}${secure}`
}

/**
 * Returns a `Set-Cookie` header that clears the auth cookie (MaxAge=0).
 */
export const createClearAuthCookie = (): string => {
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
