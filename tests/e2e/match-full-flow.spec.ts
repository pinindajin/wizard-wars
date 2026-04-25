import { test, expect } from "@playwright/test"
import { randomBytes } from "node:crypto"

import { ARENA_CAMERA_FOLLOW_ZOOM } from "../../src/shared/balance-config/rendering"

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

  // Arena follow camera: map size equals default game size, so zoom must be >1
  // or `centerOn` cannot scroll. See ARENA_CAMERA_FOLLOW_ZOOM in balance-config.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const g = (globalThis as { __wwGame?: { scene: { getScene: (k: string) => unknown } } })
            .__wwGame
          if (!g?.scene) return null
          const arena = g.scene.getScene("Arena") as
            | { cameras: { main: { zoom: number } } }
            | null
            | undefined
          if (!arena) return null
          return arena.cameras.main.zoom
        }),
      { timeout: 15_000 },
    )
    .toBe(ARENA_CAMERA_FOLLOW_ZOOM)

  // Press W; assert the local render moves "forward" (decreasing world-Y)
  // during the hold. Regression guard for the smoothing-vs-prediction bug
  // where `_updateLocal` overwrote WASD prediction with a static from→to
  // lerp, making the player visibly slide backward under held W.
  await page.locator("body").focus()

  /**
   * Reads the local player's rendered world-space Y from the live Arena
   * scene. Returns null if the scene or local render pos is not available.
   */
  const readLocalY = async (): Promise<number | null> =>
    page.evaluate(() => {
      type ArenaLike = {
        playerRenderSystem?: {
          getLocalPlayerRenderPos?: () => { x: number; y: number } | null
        }
      }
      const g = (
        globalThis as {
          __wwGame?: { scene: { getScene: (k: string) => unknown } }
        }
      ).__wwGame
      if (!g?.scene) return null
      const arena = g.scene.getScene("Arena") as ArenaLike | null | undefined
      const pos = arena?.playerRenderSystem?.getLocalPlayerRenderPos?.()
      return pos ? pos.y : null
    })

  const startY = await readLocalY()
  expect(startY, "expected local render pos available before W hold").not.toBeNull()

  await page.keyboard.down("w")
  await page.waitForTimeout(500)
  await page.keyboard.up("w")

  const endY = await readLocalY()
  expect(endY, "expected local render pos available after W hold").not.toBeNull()
  // World Y decreases moving north; any smoothing window overwriting
  // prediction (pre-fix behavior) would leave endY >= startY while W was
  // held. Allow a small epsilon so a sub-pixel stall does not flake.
  expect(
    (endY ?? 0) - (startY ?? 0),
    `expected local Y to decrease under held W (startY=${startY}, endY=${endY})`,
  ).toBeLessThan(-8)

  // Post-release no-pull-back guard (cause B + C fix): after W is
  // released, the render should stay essentially still. Before the
  // fixed-step + retain-last-input fixes, any accumulated prediction
  // error would arm a smoothing window and visibly pull the render
  // back toward the ack target for ~80 ms. Sample twice after a short
  // settle to allow one smoothing window to expire, then confirm the
  // render does not drift backward (positive y delta) by more than a
  // small epsilon.
  await page.waitForTimeout(150)
  const settledY = await readLocalY()
  await page.waitForTimeout(250)
  const afterSettleY = await readLocalY()
  expect(
    settledY,
    "expected local render pos available shortly after W release",
  ).not.toBeNull()
  expect(
    afterSettleY,
    "expected local render pos available after post-release settle",
  ).not.toBeNull()
  expect(
    (afterSettleY ?? 0) - (settledY ?? 0),
    `expected local Y NOT to drift backward after W release (settledY=${settledY}, afterSettleY=${afterSettleY})`,
  ).toBeLessThan(4)

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
