import { SignJWT, jwtVerify } from "jose"

import type { AuthUser } from "../../shared/types"
import { AUTH_TOKEN_EXPIRY } from "./constants"

/**
 * JWT helpers used by Edge middleware and Node routes.
 * Must stay free of Node-only modules (pino, bcrypt, dotenv) so Next.js can bundle this into the Edge runtime.
 */

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
 * @returns Compact JWT string suitable for the `ww-token` cookie value.
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
    // Edge middleware cannot import the structured logger (dotenv uses Node APIs). Keep this Edge-safe.
    console.warn("[auth] JWT missing required claims")
    throw new Error("Invalid token payload")
  }
  return {
    sub: verification.payload.sub,
    username: verification.payload.username,
  }
}
