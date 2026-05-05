import { test, expect } from "@playwright/test"
import { randomBytes } from "node:crypto"

/**
 * Regression: ending a match and starting another from the same lobby must not
 * deliver Colyseus combat events into a destroyed Phaser scene (rematch melee
 * crashes / frozen swing). Console and page errors fail the spec.
 */

/** Keys that may repeat every frame in Phaser; not treated as test failures. */
const CONSOLE_ALLOWLIST: RegExp[] = [/Download the React DevTools/i]

/**
 * Generates a signup-safe username (same constraints as signup.spec).
 *
 * @returns Unique username for E2E.
 */
function uniqueUsername(): string {
  return `e2e_${randomBytes(6).toString("hex")}`
}

/**
 * Installs a test-only recorder around the live GameConnection input sender.
 * Safe to call again after a new Arena mounts by clearing `__wwInputRecorderInstalled`.
 *
 * @param page - Playwright page.
 */
async function installInputRecorder(page: import("@playwright/test").Page): Promise<void> {
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
    w.__wwInputRecorderInstalled = false
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
 *
 * @param page - Playwright page.
 */
async function clearInputLog(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    ;(globalThis as unknown as { __wwInputLog?: unknown[] }).__wwInputLog = []
  })
}

/**
 * Reads the test-only input recorder log.
 *
 * @param page - Playwright page.
 */
async function readInputLog(
  page: import("@playwright/test").Page,
): Promise<
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
> {
  return page.evaluate(() => {
    return [...((globalThis as unknown as { __wwInputLog?: never[] }).__wwInputLog ?? [])]
  })
}

test("rematch: second match primary melee has no console/page errors and exits melee clip", async ({
  page,
}) => {
  test.slow()
  test.setTimeout(240_000)

  const pageErrors: string[] = []
  const consoleErrors: string[] = []

  page.on("pageerror", (err) => {
    pageErrors.push(err.message)
  })

  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const text = msg.text()
    if (CONSOLE_ALLOWLIST.some((re) => re.test(text))) return
    consoleErrors.push(text)
  })

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
  const lobbyUrl = page.url()

  const startGameAndWaitForMatch = async (): Promise<void> => {
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
              g.textures.exists("lady-wizard") &&
              g.textures.exists("arena-terrain") &&
              g.anims.exists("lady-wizard-walk-south") &&
              g.anims.exists("lady-wizard-summoned_axe_swing-south")
            return ready ? g : null
          }),
        { timeout: 60_000 },
      )
      .not.toBeNull()

    await expect(page.getByText(/^HP\b/i).first()).toBeVisible({ timeout: 30_000 })
  }

  await startGameAndWaitForMatch()

  await page.keyboard.press("\\")
  await expect(page.getByTestId("settings-modal")).toBeVisible({ timeout: 5000 })
  await page.getByRole("button", { name: /end match/i }).click()

  await expect(page.getByText(/match over/i)).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: /return to lobby/i }).click()

  await expect(page).toHaveURL(new RegExp(`${lobbyUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  await expect(page).not.toHaveURL(/\/game$/)

  await startGameAndWaitForMatch()

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        type ArenaLike = {
          playerRenderSystem?: unknown
          playerGroup?: unknown
        }
        const g = (globalThis as { __wwGame?: { scene: { getScene: (k: string) => unknown } } })
          .__wwGame
        const arena = g?.scene.getScene("Arena") as ArenaLike | null | undefined
        return arena?.playerRenderSystem != null && arena?.playerGroup != null
      })
    }, { timeout: 5000 })
    .toBe(true)

  await installInputRecorder(page)
  await clearInputLog(page)

  const canvas = page.getByTestId("game-phaser-container").locator("canvas")
  const box = await canvas.boundingBox()
  expect(box, "canvas bounding box").not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  // Match sampling in match-full-flow: hold long enough for at least one 60Hz input tick.
  await expect
    .poll(async () => (await readInputLog(page)).some((r) => r.weaponPrimary === true), {
      timeout: 15_000,
      intervals: [50, 100, 150, 200],
    })
    .toBe(true)
  await page.mouse.up()

  // Freeze watchdog: after primary melee, the one-shot swing should complete (not playing)
  // or the active clip key should clear away from summoned axe swing.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          type SpriteLike = {
            anims?: {
              isPlaying?: boolean
              currentAnim?: { key: string } | null
            }
          }
          type ArenaLike = {
            playerGroup?: { getChildren: () => SpriteLike[] }
          }
          const g = (globalThis as { __wwGame?: { scene: { getScene: (k: string) => unknown } } })
            .__wwGame
          const arena = g?.scene.getScene("Arena") as ArenaLike | null | undefined
          const sprites = arena?.playerGroup?.getChildren?.() ?? []
          const s = sprites[0] as SpriteLike | undefined
          if (!s?.anims) return false
          const key = s.anims.currentAnim?.key ?? ""
          if (!key.includes("summoned_axe_swing")) return true
          return s.anims.isPlaying !== true
        }),
      { timeout: 15_000, intervals: [100, 200, 300] },
    )
    .toBe(true)

  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([])
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([])
})
