import { test, expect } from "@playwright/test"
import { randomBytes } from "node:crypto"

/**
 * Generates a signup-safe username (same constraints as signup.spec).
 *
 * @returns Unique username for E2E.
 */
function uniqueUsername(): string {
  return `e2e_${randomBytes(6).toString("hex")}`
}

test("match start keeps user on game route with Phaser mount", async ({ page }) => {
  test.setTimeout(120_000)

  // Track every request that targets the legacy (wrong) `/assets/packs/` path.
  // Phaser scenes must load pack JSONs from `/assets/*-asset-pack.json`, not
  // `/assets/packs/*`. If any such request is made the rendering pipeline
  // is broken (canvas stays empty).
  const legacyPackRequests: string[] = []
  page.on("request", (req) => {
    const url = req.url()
    if (url.includes("/assets/packs/")) {
      legacyPackRequests.push(url)
    }
  })

  const username = uniqueUsername()
  const password = "e2e-password-123"

  await page.goto("/signup")
  await page.locator("#signup-username").fill(username)
  await page.locator("#signup-password").fill(password)

  await Promise.all([
    page.waitForURL("**/home", { timeout: 15_000 }),
    page.getByRole("button", { name: /join the arena/i }).click(),
  ])

  await page.getByRole("button", { name: /browse games/i }).click()
  await expect(page).toHaveURL(/\/browse$/)

  await page.getByRole("button", { name: /create lobby/i }).click()
  await page.waitForURL(/\/lobby\/[^/]+$/, { timeout: 30_000 })

  const startBtn = page.getByRole("button", { name: /start game/i })
  await expect(startBtn).toBeEnabled({ timeout: 30_000 })
  await startBtn.click()

  await expect(page.getByTestId("match-countdown-overlay")).toBeVisible({ timeout: 30_000 })

  await expect(page).toHaveURL(/\/lobby\/[^/]+\/game$/, { timeout: 60_000 })
  await expect(page.getByTestId("game-phaser-container")).toBeVisible({ timeout: 30_000 })
  await expect(page).not.toHaveURL(/\/browse$/)

  await expect(page.getByTestId("game-connect-error")).not.toBeVisible()

  const canvas = page.getByTestId("game-phaser-container").locator("canvas")
  await expect(canvas).toHaveCount(1, { timeout: 30_000 })
  await expect(canvas).toBeVisible({ timeout: 15_000 })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThan(0)
  expect(box!.height).toBeGreaterThan(0)

  expect(legacyPackRequests, `unexpected /assets/packs/ requests: ${legacyPackRequests.join(", ")}`).toEqual([])
})
