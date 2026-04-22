import bcrypt from "bcryptjs"
import { SignJWT, jwtVerify } from "jose"

import type { AuthUser } from "../../shared/types"
import { logger } from "../logger"

/**
 * Server-side authentication helpers: password hashing (bcryptjs), JWT issue/verify (jose HS256),
 * and serialization of the HttpOnly session cookie. All signing depends on `process.env.AUTH_SECRET`.
 */

/** Cookie name for the JWT session; must match anywhere cookies are parsed. */
export const AUTH_COOKIE_NAME = "ww-token"
/** JWT `exp` duration string passed to jose. */
const AUTH_TOKEN_EXPIRY = "7d"
/** `Max-Age` (seconds) on the Set-Cookie line; must align with AUTH_TOKEN_EXPIRY. */
const AUTH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

/**
 * Loads and UTF-8 encodes `process.env.AUTH_SECRET` for jose HS256.
 *
 * @returns Secret key material as bytes.
 * @throws If `AUTH_SECRET` is missing.
 */
const getAuthSecret = (): Uint8Array => {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error("AUTH_SECRET is required")
  }
  return new TextEncoder().encode(secret)
}

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
 * Issues a signed JWT for an authenticated user (HS256, subject + username claim).
 *
 * @param user - `AuthUser` with `sub` (user id) and `username`.
 * @returns Compact JWT string suitable for the ww-token cookie value.
 */
export const signToken = async (user: AuthUser): Promise<string> => {
  return new SignJWT({ username: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(AUTH_TOKEN_EXPIRY)
    .sign(getAuthSecret())
}

/**
 * Verifies a JWT and returns the `AuthUser` extracted from claims.
 *
 * @param token - Raw JWT string.
 * @returns `{ sub, username }` when signature and payload shape are valid.
 * @throws If verification fails or required claims are missing.
 */
export const verifyToken = async (token: string): Promise<AuthUser> => {
  const verification = await jwtVerify(token, getAuthSecret())
  if (!verification.payload.sub || typeof verification.payload.username !== "string") {
    logger.warn({ event: "auth.token.invalid_payload" }, "JWT missing required claims")
    throw new Error("Invalid token payload")
  }
  return {
    sub: verification.payload.sub,
    username: verification.payload.username,
  }
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
