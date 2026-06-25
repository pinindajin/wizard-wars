import path from "node:path"

import { defineConfig } from "vitest/config"

const perfLoadSeconds = readPositiveInt("WW_PERF_LOAD_SECONDS", 10)
const PERF_LOAD_TIMEOUT_MARGIN_MS = 180_000

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/perf-load/**/*.perf-load.test.ts"],
    testTimeout: perfLoadSeconds * 1_000 + PERF_LOAD_TIMEOUT_MARGIN_MS,
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
 * Reads one positive integer env override for perf-load test configuration.
 *
 * @param name - Environment variable name.
 * @param fallback - Value to use when unset or invalid.
 * @returns Positive integer override or fallback.
 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
