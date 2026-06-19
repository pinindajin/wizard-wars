import { execSync } from "node:child_process"
import path from "node:path"

import { defineConfig } from "vitest/config"

import { resolveRubberbandingCoverageInclude } from "./scripts/rubberbanding-coverage-scope"

/**
 * Reads repository-relative changed paths for the active rubberbanding branch.
 *
 * @returns Changed file paths, or an empty list when git is unavailable.
 */
function changedFilesFromGit(): readonly string[] {
  try {
    return execSync("git diff --name-only origin/main...HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

const RUBBERBANDING_COVERAGE_INCLUDE = resolveRubberbandingCoverageInclude({
  changedFiles: changedFilesFromGit(),
})

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      all: true,
      include: [...RUBBERBANDING_COVERAGE_INCLUDE],
      exclude: ["**/*.test.{ts,tsx}", "**/node_modules/**"],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
