import { defineConfig, devices } from "@playwright/test"

/**
 * Production server (`bun run start`) only serves a pre-built `.next` tree.
 * CI runs `bun run build` in a prior workflow step; locally, developers often run
 * `bun run test:e2e` without rebuilding, which would leave stale bundles and fail
 * specs that assert on the current UI (e.g. sprite viewer).
 */
const e2eWebServerCommand =
  process.env.CI === "true" || process.env.CI === "1" ? "bun run start" : "bun run build && bun run start"
const e2ePort = process.env.PORT ?? "3000"
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`
const e2eDbHostPort = process.env.WW_DB_HOST_PORT ?? "5436"

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // E2E drives one local Next/Colyseus server; parallel Phaser matches can
  // saturate the shared input queues and make realtime assertions flaky.
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: e2eWebServerCommand,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    // Defaults align with `.github/workflows/ci.yml` / `tests/e2e/README.md` so `bun run test:e2e` can start the webServer without a pre-exported AUTH_SECRET.
    env: {
      ...process.env,
      PORT: e2ePort,
      AUTH_SECRET:
        process.env.AUTH_SECRET ?? "test-secret-32-chars-minimum-required",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        `postgresql://ww_user:ww_pass@127.0.0.1:${e2eDbHostPort}/wizardwars`,
      WIZARD_WARS_E2E: "1",
      /** Enables `/dev/animation-tool` when `NODE_ENV=production` (see `animation-tool/page.tsx`). */
      WW_ALLOW_ANIMATION_TOOL_IN_PRODUCTION_E2E: "1",
      E2E_CLIENT_READY_TIMEOUT_MS: "800",
      WIZARD_WARS_TEST_ADMIN_CLOSE_MS: "1500",
      ADMIN_PREFIX: process.env.ADMIN_PREFIX ?? "e2eadm",
    },
  },
})
