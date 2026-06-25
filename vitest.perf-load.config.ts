import path from "node:path"

import { defineConfig } from "vitest/config"

const perfLoadSeconds = readPositiveInt("WW_PERF_LOAD_SECONDS", 10)
const PERF_LOAD_TIMEOUT_MARGIN_MS = 180_000

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/perf-load/**/*.perf-load.test.ts"],
    testTimeout: resolvePerfLoadTestTimeoutMs(process.env),
    hookTimeout: 20_000,
    teardownTimeout: 10_000,
    fileParallelism: false,
    pool: "threads",
    poolOptions: {
      threads: { singleThread: true },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})

/**
 * Resolves the Vitest timeout for perf-load runs.
 *
 * @param env - Environment source with perf-load duration and timeout overrides.
 * @returns Timeout in milliseconds.
 */
export function resolvePerfLoadTestTimeoutMs(
  env: Record<string, string | undefined>,
): number {
  const override = readPositiveIntFromEnv(env, "WW_PERF_LOAD_TEST_TIMEOUT_MS", 0)
  if (override > 0) return override
  const seconds = readPositiveIntFromEnv(env, "WW_PERF_LOAD_SECONDS", perfLoadSeconds)
  return seconds * 1_000 + PERF_LOAD_TIMEOUT_MARGIN_MS
}

/**
 * Reads one positive integer env override for perf-load test configuration.
 *
 * @param name - Environment variable name.
 * @param fallback - Value to use when unset or invalid.
 * @returns Positive integer override or fallback.
 */
function readPositiveInt(name: string, fallback: number): number {
  return readPositiveIntFromEnv(process.env, name, fallback)
}

/**
 * Reads one positive integer from an env-like object.
 *
 * @param env - Environment source.
 * @param name - Environment variable name.
 * @param fallback - Value to use when unset or invalid.
 * @returns Positive integer override or fallback.
 */
function readPositiveIntFromEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
