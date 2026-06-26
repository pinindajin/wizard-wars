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
    expect(pkg.scripts?.["start:split"]).toBe("NODE_ENV=production bun src/server/split-runtime.ts")
  })

  it("loads .env.docker for full Docker app stack scripts", () => {
    const pkg = readRootPackageJson()

    expect(pkg.scripts?.["docker:up"]).toBe("docker compose --env-file .env.docker up --build")
    expect(pkg.scripts?.["docker:reset"]).toBe(
      "docker compose --env-file .env.docker down -v && docker compose --env-file .env.docker up --build",
    )
  })
})

describe("Docker runtime packaging", () => {
  it("stops container startup when configured migrations fail", () => {
    const dockerfile = readRepoText("Dockerfile")

    expect(dockerfile).toContain('CMD ["sh", "-c", "set -e;')
    expect(dockerfile).toContain('if [ \\"${RUN_MIGRATIONS:-false}\\" = \\"true\\" ]; then bunx prisma migrate deploy; fi;')
    expect(dockerfile).toContain('case \\"${WW_SERVER_MODE:-split}\\" in')
    expect(dockerfile).toContain("exec bun run start:web")
    expect(dockerfile).toContain("exec bun run start:realtime")
    expect(dockerfile).toContain("exec bun run start:split")
    expect(dockerfile).toContain("exec bun run start")
  })

  it("passes the public Colyseus URL into Next's build-time environment", () => {
    const dockerfile = readRepoText("Dockerfile")
    const compose = readRepoText("docker-compose.yml")
    const alignedPublicUrl =
      'NEXT_PUBLIC_COLYSEUS_URL: "${NEXT_PUBLIC_COLYSEUS_URL:-http://127.0.0.1:${WW_REALTIME_HOST_PORT:-3001}}"'
    const alignedWebOrigin =
      'WW_WEB_ORIGIN: "${WW_WEB_ORIGIN:-http://127.0.0.1:${WW_APP_HOST_PORT:-3000},http://localhost:${WW_APP_HOST_PORT:-3000}}"'

    expect(dockerfile).toContain("ARG NEXT_PUBLIC_COLYSEUS_URL")
    expect(dockerfile).toContain("ENV NEXT_PUBLIC_COLYSEUS_URL=${NEXT_PUBLIC_COLYSEUS_URL}")
    expect(compose).toContain("args:")
    expect(compose).toContain("NEXT_PUBLIC_COLYSEUS_URL:")
    expect(compose).toContain(alignedPublicUrl)
    expect(compose.split(alignedPublicUrl).length - 1).toBe(3)
    expect(compose).toContain(alignedWebOrigin)
  })

  it("does not expose a checked-in realtime admin token fallback", () => {
    const dockerfile = readRepoText("Dockerfile")
    const compose = readRepoText("docker-compose.yml")
    const dockerEnvSample = readRepoText("sample.env.docker")
    const tokenOverride = 'WW_REALTIME_ADMIN_TOKEN_FROM_COMPOSE: "${WW_REALTIME_ADMIN_TOKEN:-}"'

    expect(compose).not.toContain("local-realtime-admin-token-change-me")
    expect(compose).not.toMatch(/^ +WW_REALTIME_ADMIN_TOKEN:/m)
    expect(compose).toContain(tokenOverride)
    expect(compose.split(tokenOverride).length - 1).toBe(2)
    expect(compose.split("required: false").length - 1).toBe(2)
    expect(dockerfile).toContain(
      'if [ -n \\"${WW_REALTIME_ADMIN_TOKEN_FROM_COMPOSE:-}\\" ]; then export WW_REALTIME_ADMIN_TOKEN=\\"${WW_REALTIME_ADMIN_TOKEN_FROM_COMPOSE}\\"; fi;',
    )
    expect(dockerEnvSample).toContain('WW_REALTIME_ADMIN_TOKEN="replace-with-shared-service-token"')
  })
})

describe("production image publish workflow", () => {
  it("runs E2E in a fresh gate before publishing the Docker image", () => {
    const workflow = readRepoText(".github/workflows/publish-prod-image.yml")

    expect(workflow).toContain("  quality:")
    expect(workflow).toContain("    name: Quality Gate")
    expect(workflow).toContain("  e2e:")
    expect(workflow).toContain("    name: E2E Gate")
    expect(workflow).toContain("  publish:")
    expect(workflow).toContain("    name: Build, Publish, Deploy")
    expect(workflow).toContain("    needs: [quality, e2e]")
    expect(workflow).toContain("      - name: Upload Playwright traces on failure")
    expect(workflow).toContain("          path: test-results/")
  })
})
