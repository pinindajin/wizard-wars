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
})
