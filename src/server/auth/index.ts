/**
 * Server-side authentication: password hashing (bcryptjs), JWT issue/verify (jose HS256),
 * and serialization of the HttpOnly session cookie. All signing depends on `process.env.AUTH_SECRET`.
 *
 * This file re-exports submodules only (no side-effect imports) so Edge middleware can import
 * `jwt` + `constants` without pulling bcrypt or the structured logger.
 */

export {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_EXPIRY,
  AUTH_TOKEN_MAX_AGE_SECONDS,
} from "./constants"
export { signToken, verifyToken } from "./jwt"
export { hashPassword, verifyPassword } from "./password"
export { createAuthCookie, createClearAuthCookie } from "./cookies"
