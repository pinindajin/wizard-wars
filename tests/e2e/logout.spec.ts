import { expect, test } from "@playwright/test"
import { randomBytes } from "node:crypto"

/**
 * Generates a signup-safe username.
 *
 * @returns A random username that is unique across concurrent CI runs.
 */
function uniqueUsername(): string {
  return `e2e_${randomBytes(6).toString("hex")}`
}

test("user can log out and must log in again for protected pages", async ({ page, context }) => {
  const username = uniqueUsername()
  const password = "e2e-password-123"

  await page.goto("/signup")
  await page.locator("#signup-username").fill(username)
  await page.locator("#signup-password").fill(password)

  await Promise.all([
    page.waitForURL("**/home", { timeout: 15_000 }),
    page.getByRole("button", { name: /join the arena/i }).click(),
  ])

  const signedInCookies = await context.cookies()
  expect(
    signedInCookies.find((cookie) => cookie.name === "ww-token"),
    "ww-token cookie should be set before logout",
  ).toBeDefined()

  await page.goto("/logout")
  await expect(page).toHaveURL(/\/login$/)

  const loggedOutCookies = await context.cookies()
  expect(
    loggedOutCookies.find((cookie) => cookie.name === "ww-token"),
    "ww-token cookie should be cleared after logout",
  ).toBeUndefined()

  await page.goto("/home")
  await expect(page).toHaveURL(/\/login\?next=%2Fhome$/)
})
