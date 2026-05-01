import { SignJWT, jwtVerify } from "jose"

import type { AuthUser } from "../../shared/types"

/**
 * JWT cookie naming and HS256 issue/verify (jose). This module must stay free of Node-only imports
 * (`pino`, `dotenv`, `bcryptjs`, etc.) because Next.js Edge middleware resolves the same graph.
 */

/** Cookie name for the JWT session; must match anywhere cookies are parsed. */
export const AUTH_COOKIE_NAME = "ww-token"
/** JWT `exp` duration string passed to jose. */
const AUTH_TOKEN_EXPIRY = "7d"
/** `Max-Age` (seconds) on the Set-Cookie line; must align with AUTH_TOKEN_EXPIRY. */
export const AUTH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

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
    // Structured logger lives in Node-only code; middleware runs on Edge.
    console.warn("[auth.token.invalid_payload]", "JWT missing required claims")
    throw new Error("Invalid token payload")
  }
  return {
    sub: verification.payload.sub,
    username: verification.payload.username,
  }
}
