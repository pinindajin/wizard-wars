/**
 * Shared gate for `/dev/animation-tool` and its dev-only API routes under `NODE_ENV=production`.
 *
 * Playwright / CI may run `bun run start` (production) with `WIZARD_WARS_E2E` or
 * `WW_ALLOW_ANIMATION_TOOL_IN_PRODUCTION_E2E` so routes stay reachable. Real production hosts must
 * never set those variables.
 */

/**
 * Whether automated tests have opted in to animation-tool in a production Node process.
 *
 * @returns True when the E2E / CI bypass env vars are set.
 */
export function allowAnimationToolInProductionE2e(): boolean {
  return (
    process.env.WIZARD_WARS_E2E === "1" ||
    process.env.WW_ALLOW_ANIMATION_TOOL_IN_PRODUCTION_E2E === "1"
  )
}

/**
 * Whether the animation-tool page must render the unavailable stub (production without bypass).
 *
 * @returns True when the editor body must not mount.
 */
export function isAnimationToolPageUnavailableInProduction(): boolean {
  if (process.env.NODE_ENV !== "production") return false
  return !allowAnimationToolInProductionE2e()
}

/**
 * Whether dev animation-tool mutating APIs must respond with 403 (production without bypass).
 *
 * @returns True when POST handlers should reject before touching disk.
 */
export function isAnimationToolApiForbiddenInProduction(): boolean {
  if (process.env.NODE_ENV !== "production") return false
  return !allowAnimationToolInProductionE2e()
}
