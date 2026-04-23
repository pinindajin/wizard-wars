import { test, expect } from "@playwright/test"

test("arena static asset pack is served", async ({ request }) => {
  const res = await request.get("/assets/arena-asset-pack.json")
  expect(res.status()).toBe(200)
  const json = (await res.json()) as { arena?: { files?: unknown[] } }
  expect(json.arena?.files?.length).toBeGreaterThan(0)
})

test("lady-wizard megasheet is served", async ({ request }) => {
  const res = await request.get(
    "/assets/sprites/heroes/lady-wizard/sheets/lady-wizard-megasheet.png",
  )
  expect(res.status()).toBe(200)
  expect(res.headers()["content-type"] ?? "").toMatch(/image\/png/)
})
