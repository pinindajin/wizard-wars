import { test, expect } from "@playwright/test"

test.describe("sprite viewer dev route", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  test("smoke: gallery, detail canvas, legend", async ({ page }) => {
    await page.goto("/dev/sprite-viewer")
    await expect(page.getByRole("heading", { name: /lady-wizard sprite viewer/i })).toBeVisible()
    const gallery = page.getByTestId("sprite-viewer-gallery")
    await expect(gallery).toBeVisible({ timeout: 15_000 })
    await expect(gallery.locator("button:not([disabled])").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("sprite-viewer-detail-canvas")).toBeVisible()
    await expect(page.getByTestId("sprite-viewer-legend")).toBeVisible()
  })

  test("legend ⓘ expands technical details", async ({ page }) => {
    await page.goto("/dev/sprite-viewer")
    await expect(page.getByTestId("sprite-viewer-legend")).toBeVisible()
    await page.getByTestId("sprite-viewer-legend-info-collision").click()
    const legend = page.getByTestId("sprite-viewer-legend")
    await expect(legend.getByRole("region")).toBeVisible()
    await expect(legend.getByText(/What it is/i).first()).toBeVisible()
    await page.getByTestId("sprite-viewer-legend-info-collision").click()
    await expect(legend.getByRole("region")).toHaveCount(0)
  })

  test("overlay toggles remain interactive", async ({ page }) => {
    await page.goto("/dev/sprite-viewer")
    const collision = page.getByTestId("sprite-viewer-collision-toggle")
    const edge = page.getByTestId("sprite-viewer-edge-toggle")
    await expect(collision).toBeVisible()
    await expect(edge).toBeVisible()
    await collision.uncheck()
    await edge.uncheck()
    await expect(collision).not.toBeChecked()
    await expect(edge).not.toBeChecked()
    await collision.check()
    await edge.check()
    await expect(collision).toBeChecked()
    await expect(edge).toBeChecked()
    await expect(page.getByTestId("sprite-viewer-detail-canvas")).toBeVisible()
  })
})

test.describe("sprite viewer visual capture", () => {
  test("paused detail screenshot (env-gated)", async ({ page }) => {
    test.skip(
      !process.env.WW_SPRITE_VIEWER_VISUAL,
      "set WW_SPRITE_VIEWER_VISUAL=1 to run visual capture",
    )
    await page.goto("/dev/sprite-viewer")
    await expect(page.getByTestId("sprite-viewer-detail-canvas")).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("sprite-viewer-play-toggle").click()
    await page.getByTestId("sprite-viewer-play-toggle").click()
    await page.screenshot({ path: "test-results/sprite-viewer-detail.png", fullPage: true })
  })
})
