import { expect, test } from "@playwright/test"
import { randomBytes } from "node:crypto"

function uniqueAdminUsername(): string {
  return `e2eadm${randomBytes(4).toString("hex")}`
}

test("admin can view and save log override from /dev/admin", async ({ page }) => {
  const username = uniqueAdminUsername()
  const password = "e2e-password-123"

  await page.goto("/signup")
  await page.locator("#signup-username").fill(username)
  await page.locator("#signup-password").fill(password)
  await Promise.all([
    page.waitForURL("**/home", { timeout: 15_000 }),
    page.getByRole("button", { name: /join the arena/i }).click(),
  ])

  await page.goto("/dev/admin")
  await expect(page.getByRole("heading", { name: /runtime controls/i })).toBeVisible()
  await expect(page.locator("dt", { hasText: "ADMIN_PREFIX" })).toBeVisible()
  await expect(page.getByText("e2eadm", { exact: true })).toBeVisible()

  await page.locator("select[name='logLevel']").selectOption("debug")
  await Promise.all([
    page.waitForURL(/\/dev\/admin\?saved=debug/),
    page.getByRole("button", { name: /save override/i }).click(),
  ])
  await expect(page.getByText(/this instance now uses debug/i)).toBeVisible()

  await page.locator("select[name='logLevel']").selectOption("NONE")
  await Promise.all([
    page.waitForURL(/\/dev\/admin\?saved=/),
    page.getByRole("button", { name: /save override/i }).click(),
  ])
})
