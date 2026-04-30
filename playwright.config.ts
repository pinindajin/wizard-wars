import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    // Defaults align with `.github/workflows/ci.yml` / `tests/e2e/README.md` so `bun run test:e2e` can start the webServer without a pre-exported AUTH_SECRET.
    env: {
      ...process.env,
      AUTH_SECRET:
        process.env.AUTH_SECRET ?? "test-secret-32-chars-minimum-required",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://ww_user:ww_pass@127.0.0.1:5436/wizardwars",
      WIZARD_WARS_E2E: "1",
      E2E_CLIENT_READY_TIMEOUT_MS: "800",
      ADMIN_PREFIX: process.env.ADMIN_PREFIX ?? "e2eadm",
    },
  },
})
