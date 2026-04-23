import { test, expect } from "@playwright/test"
import { randomBytes } from "node:crypto"

/**
 * Generates a signup-safe username: "e2e_" prefix + 12 lowercase hex chars,
 * total 16 chars, matching the [a-zA-Z0-9_] constraint and 3–20 char length.
 *
 * @returns A random username that is unique across concurrent CI runs.
 */
function uniqueUsername(): string {
  return `e2e_${randomBytes(6).toString("hex")}`
}

test("user can create an account and land on /home", async ({ page, context }) => {
  const username = uniqueUsername()
  const password = "e2e-password-123"

  await page.goto("/signup")
  await page.locator("#signup-username").fill(username)
  await page.locator("#signup-password").fill(password)

  await Promise.all([
    page.waitForURL("**/home", { timeout: 15_000 }),
    page.getByRole("button", { name: /join the arena/i }).click(),
  ])

  await expect(page).toHaveURL(/\/home$/)

  const cookies = await context.cookies()
  const token = cookies.find((c) => c.name === "ww-token")
  expect(token, "ww-token cookie should be set after signup").toBeDefined()
  expect(token!.value.length).toBeGreaterThan(10)
  expect(token!.httpOnly).toBe(true)
})
