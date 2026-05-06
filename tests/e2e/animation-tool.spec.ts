import { test, expect } from "@playwright/test"

/**
 * Dev animation tool: SFX waveform uses arena-pack URLs (wav/mp3); Jump uses jump strips;
 * Walk shows cadence markers. Production Playwright enables the route via `WIZARD_WARS_E2E` /
 * `WW_ALLOW_ANIMATION_TOOL_IN_PRODUCTION_E2E` (see `animation-tool/page.tsx`).
 */

async function waitForWaveformInteractive(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByTestId("animation-tool-sfx-waveform-loading")).toBeHidden({ timeout: 45_000 })
  await expect(page.getByTestId("animation-tool-sfx-waveform")).toBeEnabled({ timeout: 10_000 })
}

test.describe("animation tool dev route", () => {
  test.describe.configure({ timeout: 120_000 })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  test("loads tool on E2E production server (not the unavailable stub)", async ({ page }) => {
    await page.goto("/dev/animation-tool")
    await expect(page.getByRole("heading", { name: /animation timing tool/i })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText(/animation tool unavailable/i)).toHaveCount(0)
  })

  test("cleaver: waveform decodes and primary strip loads", async ({ page }) => {
    const pngOk = page.waitForResponse(
      (r) =>
        r.url().includes("/assets/sprites/heroes/lady-wizard/sheets/summoned-axe-attack-south.png") &&
        r.ok(),
    )
    await page.goto("/dev/animation-tool")
    await page.getByTestId("animation-tool-action-primary-red_wizard_cleaver").click()
    await pngOk
    await waitForWaveformInteractive(page)
  })

  test("jump: loads jump strip (not heavy spell cast) and waveform decodes", async ({ page }) => {
    const jumpSouth = page.waitForResponse(
      (r) =>
        r.url().includes("/assets/sprites/heroes/lady-wizard/sheets/jump-south.png") && r.ok(),
    )
    await page.goto("/dev/animation-tool")
    await page.getByTestId("animation-tool-action-spell-jump").click()
    await jumpSouth
    await waitForWaveformInteractive(page)
  })

  test("fireball: waveform decodes", async ({ page }) => {
    await page.goto("/dev/animation-tool")
    await page.getByTestId("animation-tool-action-spell-fireball").click()
    await waitForWaveformInteractive(page)
  })

  test("walk: waveform + footstep cadence markers", async ({ page }) => {
    await page.goto("/dev/animation-tool")
    await page.getByTestId("animation-tool-action-walk").click()
    await waitForWaveformInteractive(page)
    await expect(page.getByTestId("animation-tool-sfx-waveform-cadence-layer")).toBeVisible()
    await expect(page.getByTestId("animation-tool-sfx-waveform-cadence-0")).toBeVisible()
    await expect(page.getByTestId("animation-tool-sfx-waveform-cadence-1")).toBeVisible()
    await expect(page.getByText(/walk step cadence/i)).toBeVisible()
  })
})
