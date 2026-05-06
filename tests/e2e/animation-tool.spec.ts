import { test, expect } from "@playwright/test"

/**
 * Dev animation tool: SFX waveform uses arena-pack URLs; Jump uses jump strips; Walk shows cadence markers.
 * Production Playwright enables the route and dev APIs via `WIZARD_WARS_E2E` /
 * `WW_ALLOW_ANIMATION_TOOL_IN_PRODUCTION_E2E` (see `animationToolE2eGate.ts` and `playwright.config.ts`).
 */

async function waitForWaveformInteractive(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByTestId("animation-tool-sfx-waveform-loading")).toBeHidden({ timeout: 45_000 })
  await expect(page.getByTestId("animation-tool-sfx-waveform")).toBeEnabled({ timeout: 10_000 })
}

async function gotoTool(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/dev/animation-tool")
  await expect(page.getByRole("heading", { name: /animation timing tool/i })).toBeVisible({
    timeout: 30_000,
  })
}

/** `data-testid` values for `getAnimationToolActions("red_wizard")` action chips (see `AnimationToolClient`). */
const RED_WIZARD_ACTION_TEST_IDS = [
  "animation-tool-action-idle",
  "animation-tool-action-walk",
  "animation-tool-action-death",
  "animation-tool-action-spell-fireball",
  "animation-tool-action-spell-jump",
  "animation-tool-action-spell-lightning_bolt",
  "animation-tool-action-primary-red_wizard_cleaver",
] as const

test.describe("animation tool dev route", () => {
  test.describe.configure({ timeout: 180_000 })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  test("loads tool on E2E production server (not the unavailable stub)", async ({ page }) => {
    await gotoTool(page)
    await expect(page.getByText(/animation tool unavailable/i)).toHaveCount(0)
  })

  test("cleaver: waveform decodes and primary strip loads", async ({ page }) => {
    const pngOk = page.waitForResponse(
      (r) =>
        r.url().includes("/assets/sprites/heroes/lady-wizard/sheets/summoned-axe-attack-south.png") &&
        r.ok(),
    )
    await gotoTool(page)
    await page.getByTestId("animation-tool-action-primary-red_wizard_cleaver").click()
    await pngOk
    await waitForWaveformInteractive(page)
  })

  test("jump: loads jump strip (not heavy spell cast) and waveform decodes", async ({ page }) => {
    const jumpSouth = page.waitForResponse(
      (r) => r.url().includes("/assets/sprites/heroes/lady-wizard/sheets/jump-south.png") && r.ok(),
    )
    await gotoTool(page)
    await page.getByTestId("animation-tool-action-spell-jump").click()
    await jumpSouth
    await waitForWaveformInteractive(page)
  })

  test("fireball: waveform decodes", async ({ page }) => {
    await gotoTool(page)
    await page.getByTestId("animation-tool-action-spell-fireball").click()
    await waitForWaveformInteractive(page)
  })

  test("walk: waveform + footstep cadence markers", async ({ page }) => {
    await gotoTool(page)
    await page.getByTestId("animation-tool-action-walk").click()
    await waitForWaveformInteractive(page)
    await expect(page.getByTestId("animation-tool-sfx-waveform-cadence-layer")).toBeVisible()
    await expect(page.getByTestId("animation-tool-sfx-waveform-cadence-0")).toBeVisible()
    await expect(page.getByTestId("animation-tool-sfx-waveform-cadence-1")).toBeVisible()
    await expect(page.getByText(/walk step cadence/i)).toBeVisible()
  })

  test.describe("thorough sections and controls", () => {
    test("sidebar section toggles expand and collapse", async ({ page }) => {
      await gotoTool(page)
      const toggles = [
        "animation-tool-section-toggle-hero",
        "animation-tool-section-toggle-action",
        "animation-tool-section-toggle-sound-effect",
        "animation-tool-section-toggle-timing",
        "animation-tool-section-toggle-overlays-legend",
      ] as const
      for (const id of toggles) {
        const b = page.getByTestId(id)
        const wasExpanded = (await b.getAttribute("aria-expanded")) === "true"
        await b.click()
        await expect(b).toHaveAttribute("aria-expanded", wasExpanded ? "false" : "true")
        await b.click()
        await expect(b).toHaveAttribute("aria-expanded", wasExpanded ? "true" : "false")
      }
    })

    test("hero chips switch selection and shared-art banner stays visible", async ({ page }) => {
      await gotoTool(page)
      await expect(page.getByTestId("animation-tool-shared-art-banner")).toBeVisible()
      await page.getByTestId("animation-tool-hero-barbarian").click()
      await expect(page.getByTestId("animation-tool-hero-barbarian")).toHaveAttribute("aria-pressed", "true")
      await page.getByTestId("animation-tool-hero-ranger").click()
      await expect(page.getByTestId("animation-tool-hero-ranger")).toHaveAttribute("aria-pressed", "true")
      await page.getByTestId("animation-tool-hero-red_wizard").click()
      await expect(page.getByTestId("animation-tool-hero-red_wizard")).toHaveAttribute("aria-pressed", "true")
    })

    test("every red wizard action loads south preview without atlas failure", async ({ page }) => {
      await gotoTool(page)
      for (const testId of RED_WIZARD_ACTION_TEST_IDS) {
        await page.getByTestId(testId).click()
        await expect(page.getByTestId("animation-tool-preview-south")).toBeVisible({ timeout: 45_000 })
        await expect(page.getByText(/^Failed to load atlas:/)).toHaveCount(0)
      }
    })

    test("idle: sound panel explains missing SFX; waveform empty state", async ({ page }) => {
      await gotoTool(page)
      await page.getByTestId("animation-tool-action-idle").click()
      await expect(page.getByTestId("animation-tool-sfx-panel")).toContainText(/No balance-config SFX key/i)
      await expect(page.getByTestId("animation-tool-sfx-waveform-empty")).toBeVisible()
    })

    test("fireball: main play, timeline play, scrub keys, frame strip, first/prev/next", async ({ page }) => {
      await gotoTool(page)
      await page.getByTestId("animation-tool-action-spell-fireball").click()
      await expect(page.getByTestId("animation-tool-preview-south")).toBeVisible({ timeout: 45_000 })

      await page.getByTestId("animation-tool-play").click()
      await expect(page.getByTestId("animation-tool-play")).toHaveText(/Pause/i)
      await page.getByTestId("animation-tool-play").click()
      await expect(page.getByTestId("animation-tool-play")).toHaveText(/Play/i)

      await page.getByTestId("animation-tool-timeline-play").click()
      await expect(page.getByTestId("animation-tool-timeline-play")).toHaveText(/Pause/i)
      await page.getByTestId("animation-tool-timeline-play").click()
      await expect(page.getByTestId("animation-tool-timeline-play")).toHaveText(/> Play/i)

      await page.getByTestId("animation-tool-next-frame").click()
      await page.getByTestId("animation-tool-prev-frame").click()
      await page.getByTestId("animation-tool-first-frame").click()

      const scrub = page.getByTestId("animation-tool-scrub")
      await scrub.focus()
      await page.keyboard.press("End")
      await page.keyboard.press("Home")
      await page.keyboard.press("ArrowRight")

      const f2 = page.getByTestId("animation-tool-frame-2")
      if ((await f2.count()) > 0) {
        await f2.click()
      }
    })

    test("fireball: waveform click after decode; preview volume; change-sound modal open and cancel", async ({
      page,
    }) => {
      await gotoTool(page)
      await page.getByTestId("animation-tool-action-spell-fireball").click()
      await waitForWaveformInteractive(page)
      await page.getByTestId("animation-tool-sfx-waveform").click({ force: true })

      const vol = page.getByTestId("animation-tool-sfx-preview-volume")
      await vol.fill("37")
      await expect(vol).toHaveValue("37")

      await page.getByTestId("animation-tool-sfx-change-open").click()
      await expect(page.getByTestId("animation-tool-sfx-import-modal")).toBeVisible()
      await page.getByRole("button", { name: /^Cancel$/ }).click()
      await expect(page.getByTestId("animation-tool-sfx-import-modal")).toBeHidden()
    })

    test("walk: cadence tick buttons trigger without error", async ({ page }) => {
      await gotoTool(page)
      await page.getByTestId("animation-tool-action-walk").click()
      await waitForWaveformInteractive(page)
      await page.getByTestId("animation-tool-sfx-waveform-cadence-0").click()
      await page.getByTestId("animation-tool-sfx-waveform-cadence-1").click()
    })

    test("cleaver: timing panel dangerous window fields accept edits", async ({ page }) => {
      await gotoTool(page)
      await page.getByTestId("animation-tool-action-primary-red_wizard_cleaver").click()
      await page.getByTestId("animation-tool-section-toggle-timing").click()
      await page.getByTestId("animation-tool-section-toggle-timing").click()
      const start = page.getByLabel(/Dangerous start/i)
      await expect(start).toBeVisible()
      await start.fill("120")
      await expect(start).toHaveValue("120")
    })

    test("overlays: collision checkbox toggles; legend row expands", async ({ page }) => {
      await gotoTool(page)
      await page.getByTestId("animation-tool-section-toggle-overlays-legend").click()
      const collision = page.getByRole("checkbox", { name: /^collision$/i })
      await expect(collision).toBeChecked()
      await collision.click()
      await expect(collision).not.toBeChecked()
      await collision.click()
      await expect(collision).toBeChecked()

      await page.getByTestId("animation-tool-legend-info-centerpoint").click()
      await expect(page.getByTestId("animation-tool-legend-info-centerpoint")).toHaveAttribute(
        "aria-expanded",
        "true",
      )
    })

    test("save snapshot succeeds under production E2E API bypass", async ({ page }) => {
      await gotoTool(page)
      await page.getByTestId("animation-tool-save").click()
      await expect(page.getByText(/^saved /i)).toBeVisible({ timeout: 30_000 })
    })

    test("rebuild megasheet button is visible and enabled when idle", async ({ page }) => {
      await gotoTool(page)
      const rebuild = page.getByTestId("animation-tool-rebuild-megasheet")
      await expect(rebuild).toBeVisible()
      await expect(rebuild).toBeEnabled()
      await expect(rebuild).toHaveText(/Rebuild megasheet/i)
    })
  })
})
