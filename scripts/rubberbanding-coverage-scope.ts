export const RUBBERBANDING_COVERAGE_FALLBACK_INCLUDE = [
  "scripts/assert-rubberbanding-profile.ts",
  "scripts/profile-rubberbanding.ts",
  "scripts/rubberbanding-coverage-scope.ts",
] as const

type ResolveRubberbandingCoverageIncludeOptions = {
  readonly changedFiles: readonly string[]
}

type ValidateRubberbandingCoverageScopeOptions = {
  readonly changedFiles: readonly string[]
  readonly configuredInclude: readonly string[]
}

export type RubberbandingCoverageScopeValidation = {
  readonly ok: boolean
  readonly missing: readonly string[]
}

/**
 * Resolves production TypeScript files that must be included in the rubberbanding coverage gate.
 *
 * @param options - Changed repository paths from a git diff or test fixture.
 * @returns Sorted coverage include globs for changed production code.
 */
export function resolveRubberbandingCoverageInclude(
  options: ResolveRubberbandingCoverageIncludeOptions,
): readonly string[] {
  const include = options.changedFiles.filter(isProductionTypeScriptPath).sort()
  return include.length === 0 ? [...RUBBERBANDING_COVERAGE_FALLBACK_INCLUDE] : include
}

/**
 * Validates that the configured coverage include list contains every changed production file.
 *
 * @param options - Changed files and the configured include list.
 * @returns Scope validation result with any missing paths.
 */
export function validateRubberbandingCoverageScope(
  options: ValidateRubberbandingCoverageScopeOptions,
): RubberbandingCoverageScopeValidation {
  const required = resolveRubberbandingCoverageInclude({ changedFiles: options.changedFiles })
  const configured = new Set(options.configuredInclude)
  const missing = required.filter((file) => !configured.has(file))
  return {
    ok: missing.length === 0,
    missing,
  }
}

/**
 * Determines whether a repository path is production TypeScript covered by this PR gate.
 *
 * @param filePath - Repository-relative file path.
 * @returns True when the path should count as changed production code.
 */
function isProductionTypeScriptPath(filePath: string): boolean {
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return false
  if (!filePath.startsWith("src/") && !filePath.startsWith("scripts/")) return false
  if (filePath.endsWith(".test.ts") || filePath.endsWith(".test.tsx")) return false
  if (filePath.endsWith(".spec.ts") || filePath.endsWith(".spec.tsx")) return false
  return true
}
