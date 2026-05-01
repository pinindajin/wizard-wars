/**
 * Auth verification feature flags shared by Node auth surfaces.
 */

/**
 * Returns whether protected routes should verify the JWT user still exists in the DB.
 *
 * @param value - Raw env value; defaults to `VERIFY_USER_ON_PROTECTED`.
 * @returns True when DB-backed protected verification is enabled.
 */
export function shouldVerifyUserOnProtected(
  value = process.env.VERIFY_USER_ON_PROTECTED,
): boolean {
  return value === "true" || value === "1"
}
