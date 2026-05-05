import { test, expect } from "@playwright/test"
import { randomBytes } from "node:crypto"

import {
  ARENA_WORLD_COLLIDERS,
  PLAYER_WORLD_COLLISION_OFFSET_Y_PX,
  PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
} from "../../src/shared/balance-config"
import { ARENA_CAMERA_FOLLOW_ZOOM } from "../../src/shared/balance-config/rendering"

/**
 * Foot Y of the north collision boundary for the column containing `spawnX`,
 * using the same rules as the legacy test (closest northern collider strip
 * above `spawnY`). Spawn points are **shuffled** at match start, so we must
 * not assume {@link ARENA_SPAWN_POINTS}[0].
 */
function northBarrierFootY(spawnX: number, spawnY: number): number {
  const topClearance = PLAYER_WORLD_COLLISION_RADIUS_Y_PX - PLAYER_WORLD_COLLISION_OFFSET_Y_PX
  const northOfSpawn = ARENA_WORLD_COLLIDERS.filter(
    (col) =>
      spawnX >= col.x - PLAYER_WORLD_COLLISION_RADIUS_X_PX &&
      spawnX <= col.x + col.width + PLAYER_WORLD_COLLISION_RADIUS_X_PX &&
      col.y + col.height <= spawnY - topClearance,
  )
  if (northOfSpawn.length === 0) {
    throw new Error(
      `E2E: no north collider for spawn (${spawnX}, ${spawnY}); check arena layout`,
    )
  }
  const blocker = northOfSpawn.reduce((best, col) =>
    col.y + col.height > best.y + best.height ? col : best,
  )
  return blocker.y + blocker.height + topClearance
}

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
    // Chat presence uses Colyseus-specific handlers; wildcard lobby routing may not subscribe.
    if (/chat_presence/i.test(text)) return
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

  const minimap = page.getByTestId("game-minimap")
  await expect(minimap).toBeVisible({ timeout: 10_000 })
  await expect(minimap).toHaveAttribute("data-corner", "top_left")
  await expect(minimap).toHaveAttribute("data-mode", "compact")
  const compactBox = await minimap.boundingBox()
  expect(compactBox?.x ?? Infinity, "expected minimap in left corner").toBeLessThan(260)
  expect(compactBox?.y ?? Infinity, "expected minimap in top corner").toBeLessThan(120)
  await page.keyboard.press("m")
  await expect(minimap).toHaveAttribute("data-mode", "expanded")
  const expandedBox = await minimap.boundingBox()
  expect(expandedBox?.width ?? 0, "expected expanded minimap to be wider").toBeGreaterThan(
    (compactBox?.width ?? 0) * 2,
  )
  await page.keyboard.press("m")
  await expect(minimap).toHaveAttribute("data-mode", "compact")

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
   * Reads the local player's rendered world-space position from the live Arena
   * scene. Returns null if the scene or local render pos is not available.
   */
  const readLocalPos = async (): Promise<{ x: number; y: number } | null> =>
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
      return arena?.playerRenderSystem?.getLocalPlayerRenderPos?.() ?? null
    })

  /**
   * Installs a test-only recorder around the live GameConnection input sender.
   */
  const installInputRecorder = async (): Promise<void> => {
    await page.evaluate(() => {
      type PlayerInput = {
        weaponPrimary: boolean
        weaponSecondary: boolean
        abilitySlot: number | null
        useQuickItemSlot: number | null
        up: boolean
        down: boolean
        left: boolean
        right: boolean
      }
      type ConnectionLike = {
        sendPlayerInput: (input: PlayerInput) => void
      }
      type ArenaLike = {
        getConnection?: () => ConnectionLike
      }
      const w = globalThis as unknown as {
        __wwGame?: { scene: { getScene: (k: string) => unknown } }
        __wwInputLog?: PlayerInput[]
        __wwInputRecorderInstalled?: boolean
      }
      if (w.__wwInputRecorderInstalled) return
      const arena = w.__wwGame?.scene.getScene("Arena") as ArenaLike | undefined
      const conn = arena?.getConnection?.()
      if (!conn) throw new Error("E2E input recorder: GameConnection missing")
      const original = conn.sendPlayerInput.bind(conn)
      w.__wwInputLog = []
      conn.sendPlayerInput = (input: PlayerInput) => {
        w.__wwInputLog?.push({ ...input })
        original(input)
      }
      w.__wwInputRecorderInstalled = true
    })
  }

  /**
   * Clears the test-only input recorder log.
   */
  const clearInputLog = async (): Promise<void> => {
    await page.evaluate(() => {
      ;(globalThis as unknown as { __wwInputLog?: unknown[] }).__wwInputLog = []
    })
  }

  /**
   * Reads the test-only input recorder log.
   */
  const readInputLog = async (): Promise<
    Array<{
      weaponPrimary: boolean
      weaponSecondary: boolean
      abilitySlot: number | null
      useQuickItemSlot: number | null
      up: boolean
      down: boolean
      left: boolean
      right: boolean
    }>
  > =>
    page.evaluate(() => {
      return [
        ...((globalThis as unknown as { __wwInputLog?: never[] }).__wwInputLog ?? []),
      ]
    })

  /**
   * Sets a range input and dispatches React-compatible input/change events.
   *
   * @param testId - Locator test id.
   * @param value - New numeric value.
   */
  const setRange = async (testId: string, value: number): Promise<void> => {
    await page.getByTestId(testId).evaluate((el, nextValue) => {
      const input = el as HTMLInputElement
      input.value = String(nextValue)
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new Event("change", { bubbles: true }))
    }, value)
  }

  /**
   * Waits until the input recorder has at least one sample (CI-safe vs fixed sleeps).
   *
   * @param minCount - Minimum log entries required.
   */
  const waitForInputSamples = async (minCount: number): Promise<void> => {
    await expect
      .poll(async () => (await readInputLog()).length, {
        timeout: 5000,
        intervals: [50, 100, 150, 200],
      })
      .toBeGreaterThanOrEqual(minCount)
  }

  const startPos = await readLocalPos()
  expect(startPos, "expected local render pos available before W hold").not.toBeNull()
  const startY = startPos!.y
  const northEdgeY = northBarrierFootY(startPos!.x, startPos!.y)

  await page.keyboard.down("w")
  await page.waitForTimeout(500)
  await page.keyboard.up("w")

  const endPos = await readLocalPos()
  expect(endPos, "expected local render pos available after W hold").not.toBeNull()
  const endY = endPos!.y
  // World Y decreases moving north; any smoothing window overwriting
  // prediction (pre-fix behavior) would leave endY >= startY while W was
  // held. Allow a small epsilon so a sub-pixel stall does not flake.
  expect(
    (endY ?? 0) - (startY ?? 0),
    `expected local Y to decrease under held W (startY=${startY}, endY=${endY})`,
  ).toBeLessThan(-8)
  expect(
    endY ?? 0,
    `expected local Y to stop at north non-walkable edge (edgeY=${northEdgeY}, endY=${endY})`,
  ).toBeGreaterThanOrEqual(northEdgeY - 2)

  // Post-release no-pull-back guard (cause B + C fix): after W is
  // released, the render should stay essentially still. Before the
  // fixed-step + retain-last-input fixes, any accumulated prediction
  // error would arm a smoothing window and visibly pull the render
  // back toward the ack target for ~80 ms. Sample twice after a short
  // settle to allow one smoothing window to expire, then confirm the
  // render does not drift backward (positive y delta) by more than a
  // small epsilon.
  await page.waitForTimeout(150)
  const settledY = (await readLocalPos())?.y ?? null
  await page.waitForTimeout(250)
  const afterSettleY = (await readLocalPos())?.y ?? null
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

  await installInputRecorder()

  // Settings modal: BGM/SFX save and gameplay input block.
  await page.keyboard.press("\\")
  await expect(page.getByTestId("settings-modal")).toBeVisible({ timeout: 5000 })
  await page.keyboard.press("m")
  await expect(minimap).toHaveAttribute("data-mode", "compact")
  await setRange("settings-bgm-volume", 23)
  await setRange("settings-sfx-volume", 34)
  await page.getByTestId("settings-minimap-corner-bottom_right").click()
  await page.getByTestId("settings-save").click()
  await expect(page.getByText(/settings saved/i)).toBeVisible({ timeout: 5000 })
  await expect(minimap).toHaveAttribute("data-corner", "bottom_right")

  await clearInputLog()
  await page.mouse.down()
  await page.keyboard.press("1")
  await waitForInputSamples(1)
  await page.mouse.up()
  const settingsInputs = await readInputLog()
  expect(settingsInputs.length, "expected input samples while settings modal is open").toBeGreaterThan(0)
  expect(settingsInputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        weaponPrimary: false,
        weaponSecondary: false,
        abilitySlot: null,
        useQuickItemSlot: null,
        up: false,
        down: false,
        left: false,
        right: false,
      }),
    ]),
  )
  expect(
    settingsInputs.every(
      (input) =>
        !input.weaponPrimary &&
        !input.weaponSecondary &&
        input.abilitySlot == null &&
        input.useQuickItemSlot == null,
    ),
    `expected settings modal to block attack/cast inputs: ${JSON.stringify(settingsInputs.slice(-10))}`,
  ).toBe(true)
  await page
    .getByTestId("settings-modal")
    .getByRole("button", { name: "Cancel" })
    .click()
  await expect(page.getByTestId("settings-modal")).toBeHidden({ timeout: 5000 })

  // Open the shop with B.
  await page.keyboard.press("b")
  await expect(page.getByTestId("shop-modal")).toBeVisible({ timeout: 5000 })

  await clearInputLog()
  await page.mouse.down()
  await page.keyboard.press("1")
  await waitForInputSamples(1)
  await page.mouse.up()
  const shopInputs = await readInputLog()
  expect(shopInputs.length, "expected input samples while shop modal is open").toBeGreaterThan(0)
  expect(
    shopInputs.every(
      (input) =>
        !input.weaponPrimary &&
        !input.weaponSecondary &&
        input.abilitySlot == null &&
        input.useQuickItemSlot == null,
    ),
    `expected shop modal to block attack/cast inputs: ${JSON.stringify(shopInputs.slice(-10))}`,
  ).toBe(true)

  // Verify shop shows all categories + lightning_bolt buy button enabled.
  await expect(page.getByTestId("shop-section-ability")).toBeVisible()
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
