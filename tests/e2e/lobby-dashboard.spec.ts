import { expect, test, type Page } from "@playwright/test"
import { randomBytes } from "node:crypto"

/**
 * Creates a unique E2E username.
 *
 * @param prefix - Username prefix.
 * @returns Signup-safe username.
 */
function uniqueUsername(prefix: string): string {
  return `${prefix}${randomBytes(5).toString("hex")}`
}

/**
 * Signs up a test user through the UI.
 *
 * @param page - Playwright page.
 * @param username - Username to create.
 */
async function signup(page: Page, username: string): Promise<void> {
  await page.goto("/signup")
  await page.locator("#signup-username").fill(username)
  await page.locator("#signup-password").fill("e2e-password-123")
  await Promise.all([
    page.waitForURL("**/home", { timeout: 15_000 }),
    page.getByRole("button", { name: /join the arena/i }).click(),
  ])
}

test("admin dashboard shows lobbies and closes occupied lobby", async ({ browser }) => {
  test.setTimeout(120_000)

  const playerContext = await browser.newContext()
  const adminContext = await browser.newContext()
  const playerPage = await playerContext.newPage()
  const adminPage = await adminContext.newPage()

  await signup(playerPage, uniqueUsername("e2eplayer"))
  await playerPage.goto("/browse")
  await playerPage.getByRole("button", { name: /^create lobby$/i }).click()
  await playerPage.waitForURL(/\/lobby\/[^/]+$/, { timeout: 30_000 })
  const lobbyId = playerPage.url().split("/").pop()
  expect(lobbyId).toBeTruthy()

  await signup(adminPage, uniqueUsername("e2eadm"))
  await adminPage.goto("/dev/lobby-dashboard")
  const lobbyCard = adminPage.getByTestId("dashboard-lobby-card").filter({ hasText: lobbyId! })
  await expect(lobbyCard).toBeVisible({ timeout: 15_000 })
  await lobbyCard.getByRole("button", { name: /^close lobby$/i }).click()
  const confirmDialog = adminPage.getByTestId("close-lobby-confirm")
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole("button", { name: /^close lobby$/i }).click()

  await expect(playerPage.getByTestId("admin-closing-modal")).toBeVisible({ timeout: 10_000 })
  await expect(playerPage).toHaveURL(/\/browse$/, { timeout: 10_000 })
  await expect(lobbyCard).toBeHidden({ timeout: 10_000 })

  await playerContext.close()
  await adminContext.close()
})

test("non-admin cannot open lobby dashboard", async ({ page }) => {
  await signup(page, uniqueUsername("e2eplain"))

  const response = await page.goto("/dev/lobby-dashboard")

  expect(response?.status()).toBe(404)
})
