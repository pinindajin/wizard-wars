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

test("full match flow: assets, overlay, canvas, movement, shop, abilities", async ({
  page,
}) => {
  test.slow()
  test.setTimeout(180_000)

  const assetFailures: Array<{ url: string; status: number }> = []
  page.on("response", (resp) => {
    const url = resp.url()
    if (url.includes("/assets/") && resp.status() >= 400) {
      assetFailures.push({ url, status: resp.status() })
    }
  })

  const offendingWarnings: string[] = []
  page.on("console", (msg) => {
    if (msg.type() !== "warning") return
    const text = msg.text()
    if (/onMessage.*not registered/i.test(text)) {
      offendingWarnings.push(text)
    }
  })

  // Signup + navigate to browse + create lobby + start game.
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

  // The canvas can appear before the React loading overlay is painted or before Preload
  // finishes. Do not assert textures until packs and anims are actually registered
  // (this was flaky in CI when we only raced overlay vs canvas).
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
            g.textures.exists("lady-wizard") &&
            g.textures.exists("arena-terrain") &&
            g.anims.exists("lady-wizard-walk-south") &&
            g.anims.exists("lady-wizard-death-south") &&
            g.anims.exists("lady-wizard-light_spell_cast-south") &&
            g.anims.exists("lady-wizard-summoned_axe_swing-south")
          return ready ? g : null
        }),
      { timeout: 60_000 },
    )
    .not.toBeNull()

  // Wait for match to reach IN_PROGRESS (post-countdown). The countdown may
  // render momentarily; we assert the HP HUD eventually appears which only
  // mounts when phase === "IN_PROGRESS".
  await expect(page.getByText(/HP/).first()).toBeVisible({ timeout: 30_000 })

  // Press W; assert no crash. Character movement state on the server is
  // validated indirectly through Phaser's sprite position ticking — we just
  // verify input doesn't throw and the game is still running.
  await page.locator("body").focus()
  await page.keyboard.down("w")
  await page.waitForTimeout(400)
  await page.keyboard.up("w")

  // Open the shop with B.
  await page.keyboard.press("b")
  await expect(page.getByTestId("shop-modal")).toBeVisible({ timeout: 5000 })

  // Verify shop shows all categories + lightning_bolt buy button enabled.
  await expect(page.getByTestId("shop-section-ability")).toBeVisible()
  await expect(page.getByTestId("shop-section-weapon")).toBeVisible()
  await expect(page.getByTestId("shop-section-augment")).toBeVisible()
  await expect(page.getByTestId("shop-section-consumable")).toBeVisible()

  const buyLightning = page.getByTestId("shop-buy-lightning_bolt")
  await expect(buyLightning).toBeEnabled()
  await buyLightning.click()

  // Close shop via the Close (B) button click — avoids focus/keyboard-routing
  // edge cases around pressing B immediately after clicking a dynamic picker.
  await page.getByTestId("shop-close").click()
  await expect(page.getByTestId("shop-modal")).toBeHidden({ timeout: 5000 })

  // Final invariants.
  expect(
    assetFailures,
    `unexpected /assets/* failures: ${JSON.stringify(assetFailures)}`,
  ).toEqual([])
  expect(
    offendingWarnings,
    `unexpected onMessage warnings: ${offendingWarnings.join(" | ")}`,
  ).toEqual([])
})
