import { test, expect } from "@playwright/test"
import { randomBytes } from "node:crypto"

/**
 * Generates a signup-safe username (same constraints as signup.spec).
 */
function uniqueUsername(): string {
  return `e2e_${randomBytes(6).toString("hex")}`
}

/**
 * Headless screenshot of the arena after casting fireball (slot 0 / default key `1`).
 * Skipped in default CI; run locally with:
 * `WW_FIREBALL_VISUAL=1 bunx playwright test tests/e2e/fireball-trail-visual.spec.ts`
 *
 * Output: `test-results/fireball-trail.png` (repo-relative; Playwright creates `test-results/`).
 */
test("fireball trail visual capture (env-gated)", async ({ page }) => {
  test.skip(
    !process.env.WW_FIREBALL_VISUAL,
    "set WW_FIREBALL_VISUAL=1 to run this visual capture",
  )
  test.slow()
  test.setTimeout(180_000)

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

  await expect(page).toHaveURL(/\/lobby\/[^/]+\/game$/, { timeout: 60_000 })

  const canvas = page.getByTestId("game-phaser-container").locator("canvas")
  await expect(canvas).toBeVisible({ timeout: 30_000 })

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          type WWGame = {
            textures: { exists: (k: string) => boolean }
            anims: { exists: (k: string) => boolean }
          }
          const g = (globalThis as unknown as { __wwGame?: WWGame }).__wwGame
          if (!g) return null
          const ready =
            g.textures.exists("fireball") &&
            g.textures.exists("ember") &&
            g.anims.exists("fireball-fly")
          return ready ? g : null
        }),
      { timeout: 60_000 },
    )
    .not.toBeNull()

  await expect(page.getByText(/HP/).first()).toBeVisible({ timeout: 30_000 })

  await page.locator("body").focus()
  const box = await canvas.boundingBox()
  expect(box, "canvas should have layout").not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)

  await page.keyboard.press("1")
  await page.waitForTimeout(600)

  await page.screenshot({
    path: "test-results/fireball-trail.png",
    fullPage: true,
  })
})
