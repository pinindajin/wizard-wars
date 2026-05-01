import bcrypt from "bcryptjs"

import { AUTH_COOKIE_NAME, AUTH_TOKEN_MAX_AGE_SECONDS } from "./jwt"

export { AUTH_COOKIE_NAME, AUTH_TOKEN_MAX_AGE_SECONDS, signToken, verifyToken } from "./jwt"

/**
 * Server-side authentication helpers: password hashing (bcryptjs), JWT issue/verify (jose HS256),
 * and serialization of the HttpOnly session cookie. All signing depends on `process.env.AUTH_SECRET`.
 */

/**
 * Hashes a plaintext password with bcrypt (cost factor 10).
 *
 * @param password - Raw password from signup/login forms.
 * @returns bcrypt hash string suitable for `User.passwordHash` in Prisma.
 */
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, 10)
}

/**
 * Compares a plaintext password to a stored bcrypt hash.
 *
 * @param password - Candidate password from login.
 * @param hash - Stored `passwordHash` from the database.
 * @returns `true` if the password matches.
 */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash)
}

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
