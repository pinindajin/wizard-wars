export type ServerMode = "single" | "web" | "realtime"
type EnvMap = { readonly [key: string]: string | undefined }

/**
 * Resolves which process role the current server entrypoint should run.
 *
 * @param env - Environment map to read.
 * @returns Server role, defaulting to the current single-process mode.
 */
export function resolveServerMode(env: EnvMap = process.env): ServerMode {
  const value = env.WW_SERVER_MODE?.trim().toLowerCase()
  if (value === "web" || value === "realtime") return value
  return "single"
}

/**
 * Determines whether this process owns Prisma migration execution.
 *
 * @param env - Environment map to read.
 * @returns True only when `RUN_MIGRATIONS=true`.
 */
export function shouldRunMigrations(env: EnvMap = process.env): boolean {
  return env.RUN_MIGRATIONS?.trim().toLowerCase() === "true"
}
