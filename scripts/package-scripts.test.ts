import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

type PackageJson = {
  scripts?: Record<string, string>
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = join(__dirname, "..")

/**
 * Reads the repository root `package.json` for invariant checks on npm/bun scripts.
 *
 * @returns Parsed package manifest (minimal shape used by tests).
 */
function readRootPackageJson(): PackageJson {
  const raw = readFileSync(join(repoRoot, "package.json"), "utf8")
  return JSON.parse(raw) as PackageJson
}

/**
 * Reads a repository-root text file for packaging invariant checks.
 *
 * @param relativePath - Path relative to the repository root.
 * @returns The file contents as UTF-8 text.
 */
function readRepoText(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8")
}

describe("package.json dev scripts", () => {
  it("runs dev:animation-tool through Docker-backed dev-with-docker (not bare tsx server)", () => {
    const pkg = readRootPackageJson()
    const script = pkg.scripts?.["dev:animation-tool"]
    expect(script).toBe("bun ./scripts/dev-with-docker.ts")
  })

  it("keeps dev:hybrid and dev:stack on scripts/dev-with-docker.ts", () => {
    const pkg = readRootPackageJson()
    const hybrid = pkg.scripts?.["dev:hybrid"]
    const stack = pkg.scripts?.["dev:stack"]
    expect(hybrid).toBe("bun ./scripts/dev-with-docker.ts")
    expect(stack).toBe("bun ./scripts/dev-with-docker.ts")
  })

  it("has a dedicated 100% rubberbanding changed-code coverage gate", () => {
    const pkg = readRootPackageJson()

    expect(pkg.scripts?.["test:rubberbanding:coverage"]).toBe(
      "vitest run --config vitest.rubberbanding-coverage.config.ts --coverage && bun scripts/assert-rubberbanding-coverage.ts",
    )
  })

  it("keeps perf-load checks on an explicit opt-in script", () => {
    const pkg = readRootPackageJson()

    expect(pkg.scripts?.["test:perf-load"]).toBe(
      "vitest run --config vitest.perf-load.config.ts",
    )
  })

  it("exposes separate production web and realtime start commands", () => {
    const pkg = readRootPackageJson()

    expect(pkg.scripts?.["start:web"]).toBe("NODE_ENV=production WW_SERVER_MODE=web bun server.ts")
    expect(pkg.scripts?.["start:realtime"]).toBe(
      "NODE_ENV=production WW_SERVER_MODE=realtime bun src/server/colyseus/realtime-server.ts",
    )
  })
})

describe("Docker runtime packaging", () => {
  it("passes the public Colyseus URL into Next's build-time environment", () => {
    const dockerfile = readRepoText("Dockerfile")
    const compose = readRepoText("docker-compose.yml")

    expect(dockerfile).toContain("ARG NEXT_PUBLIC_COLYSEUS_URL")
    expect(dockerfile).toContain("ENV NEXT_PUBLIC_COLYSEUS_URL=${NEXT_PUBLIC_COLYSEUS_URL}")
    expect(compose).toContain("args:")
    expect(compose).toContain("NEXT_PUBLIC_COLYSEUS_URL:")
    expect(compose).toContain(
      'NEXT_PUBLIC_COLYSEUS_URL: "${NEXT_PUBLIC_COLYSEUS_URL:-http://127.0.0.1:3001}"',
    )
  })
})
