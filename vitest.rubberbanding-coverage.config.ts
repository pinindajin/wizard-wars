import { execSync } from "node:child_process"
import path from "node:path"

import { defineConfig } from "vitest/config"

import {
  mergeRubberbandingChangedFiles,
  resolveRubberbandingCoverageInclude,
} from "./scripts/rubberbanding-coverage-scope"

/**
 * Reads repository-relative changed paths for the active rubberbanding branch.
 *
 * @returns Changed file paths, or an empty list when git is unavailable.
 */
function changedFilesForCommand(command: string): readonly string[] {
  try {
    return execSync(command, {
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

/**
 * Reads committed, staged, and unstaged repository-relative changed paths.
 *
 * @returns Sorted unique changed file paths, or an empty list when git is unavailable.
 */
function changedFilesFromGit(): readonly string[] {
  return mergeRubberbandingChangedFiles([
    changedFilesForCommand("git diff --name-only origin/main...HEAD"),
    changedFilesForCommand("git diff --name-only --cached"),
    changedFilesForCommand("git diff --name-only"),
  ])
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
      reporter: ["text", "text-summary", "json"],
      all: true,
      include: [...RUBBERBANDING_COVERAGE_INCLUDE],
      exclude: ["**/*.test.{ts,tsx}", "**/node_modules/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
