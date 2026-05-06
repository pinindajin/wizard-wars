import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { randomBytes } from "node:crypto"

function uniqueUsername(prefix: string): string {
  return `${prefix}${randomBytes(5).toString("hex")}`
}

async function signup(page: Page, username: string) {
  await page.goto("/signup")
  await page.locator("#signup-username").fill(username)
  await page.locator("#signup-password").fill("e2e-password-123")
  await Promise.all([
    page.waitForURL("**/home", { timeout: 15_000 }),
    page.getByRole("button", { name: /join the arena/i }).click(),
  ])
}

test("admin closes occupied lobby from server browser", async ({ browser }) => {
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
  await adminPage.goto("/browse")
  const lobbyRow = adminPage.getByTestId(`lobby-row-${lobbyId!}`)
  await expect(lobbyRow).toBeVisible({ timeout: 15_000 })
  await lobbyRow.getByRole("button", { name: /^close$/i }).click()
  await expect(adminPage.getByTestId("close-lobby-confirm")).toBeVisible()
  await adminPage.getByRole("button", { name: /^close lobby$/i }).click()

  await expect(playerPage.getByTestId("admin-closing-modal")).toBeVisible({ timeout: 10_000 })
  await expect(playerPage).toHaveURL(/\/browse$/, { timeout: 10_000 })
  await expect(adminPage.getByText(lobbyId!)).toBeHidden({ timeout: 10_000 })

  await playerContext.close()
  await adminContext.close()
})

test("non-admin cannot see close controls", async ({ page }) => {
  await signup(page, uniqueUsername("e2eplain"))
  await page.goto("/browse")

  await expect(page.getByRole("button", { name: /^close$/i })).toHaveCount(0)
})
