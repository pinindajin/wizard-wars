import { expect, type Page } from "@playwright/test"
import { randomBytes } from "node:crypto"

/**
 * Generates a signup-safe username.
 *
 * @returns Unique username for E2E.
 */
function uniqueUsername(): string {
  return `e2e_${randomBytes(6).toString("hex")}`
}

/**
 * Creates a one-player lobby and waits until the in-match HUD is usable.
 *
 * @param page - Playwright page.
 */
export async function startSinglePlayerMatch(page: Page): Promise<void> {
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
  await expect(page.getByTestId("game-phaser-container").locator("canvas")).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText(/HP/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId("ability-slot-0")).toBeVisible({ timeout: 10_000 })
  await pauseAutomaticPlayerInputs(page)
  await page.locator("body").focus()
}

/**
 * Stops the normal per-frame input sender for this E2E page.
 * The ability scenario sends explicit one-shot inputs instead, avoiding queue
 * saturation when the full Playwright suite runs several Phaser matches at once.
 *
 * @param page - Playwright page.
 */
async function pauseAutomaticPlayerInputs(page: Page): Promise<void> {
  await page.evaluate(() => {
    type PlayerRenderSystemLike = {
      update: (
        delta: number,
        keyboardInput: unknown,
        sendInput: () => void,
      ) => void
    }
    type ArenaLike = {
      __wwAbilityInputPauseInstalled?: boolean
      playerRenderSystem?: PlayerRenderSystemLike
    }
    const game = (
      globalThis as unknown as {
        __wwGame?: { scene: { getScene: (key: string) => unknown } }
      }
    ).__wwGame
    const arena = game?.scene.getScene("Arena") as ArenaLike | null | undefined
    const playerRenderSystem = arena?.playerRenderSystem
    if (!arena || !playerRenderSystem || arena.__wwAbilityInputPauseInstalled) return

    const originalUpdate = playerRenderSystem.update.bind(playerRenderSystem)
    playerRenderSystem.update = (delta, keyboardInput) => {
      originalUpdate(delta, keyboardInput, () => undefined)
    }
    arena.__wwAbilityInputPauseInstalled = true
  })
}

/**
 * Reads the visible jump charge badge.
 *
 * @param page - Playwright page.
 * @returns Numeric charge count.
 */
async function readJumpCharges(page: Page): Promise<number> {
  const text = await page.getByTestId("ability-slot-1-charge-count").textContent()
  return Number(text ?? Number.NaN)
}

/**
 * Sends one ability-slot input through the live game connection.
 *
 * @param page - Playwright page.
 * @param slotIndex - Zero-based ability slot index.
 */
async function sendAbilitySlotInput(page: Page, slotIndex: number): Promise<void> {
  await page.evaluate((abilitySlot) => {
    type PlayerInput = {
      up: boolean
      down: boolean
      left: boolean
      right: boolean
      abilitySlot: number | null
      abilityTargetX: number
      abilityTargetY: number
      weaponPrimary: boolean
      weaponSecondary: boolean
      weaponTargetX: number
      weaponTargetY: number
      useQuickItemSlot: number | null
      seq: number
      clientSendTimeMs: number
    }
    type ConnectionLike = {
      nextSeq: () => number
      sendPlayerInput: (input: PlayerInput) => void
    }
    type ArenaLike = {
      getConnection?: () => ConnectionLike
    }
    const game = (
      globalThis as unknown as {
        __wwGame?: { scene: { getScene: (key: string) => unknown } }
      }
    ).__wwGame
    const arena = game?.scene.getScene("Arena") as ArenaLike | null | undefined
    const connection = arena?.getConnection?.()
    if (!connection) throw new Error("E2E ability input: GameConnection missing")
    connection.sendPlayerInput({
      up: false,
      down: false,
      left: false,
      right: false,
      abilitySlot,
      abilityTargetX: 700,
      abilityTargetY: 350,
      weaponPrimary: false,
      weaponSecondary: false,
      weaponTargetX: 700,
      weaponTargetY: 350,
      useQuickItemSlot: null,
      seq: connection.nextSeq(),
      clientSendTimeMs: Date.now(),
    })
  }, slotIndex)
}

/**
 * Retries a jump key press until the HUD charge badge decreases.
 *
 * @param page - Playwright page.
 * @param before - Charge count before the attempted jump.
 */
async function spendOneJumpCharge(page: Page, before: number): Promise<void> {
  const deadline = Date.now() + 10_000
  do {
    await sendAbilitySlotInput(page, 1)
    const observed = await expect
      .poll(async () => readJumpCharges(page), {
        timeout: 700,
        intervals: [50, 100, 150],
      })
      .toBeLessThan(before)
      .then(() => true)
      .catch(() => false)
    if (observed) return
    await page.waitForTimeout(250)
  } while (Date.now() < deadline)

  expect(await readJumpCharges(page)).toBeLessThan(before)
}

/**
 * Buys jump, assigns it to the second ability slot, and verifies the charge badge.
 *
 * @param page - Playwright page.
 */
export async function buyAndAssignJump(page: Page): Promise<void> {
  await page.keyboard.press("b")
  await expect(page.getByTestId("shop-modal")).toBeVisible({ timeout: 5000 })

  const buyJump = page.getByTestId("shop-buy-jump")
  await expect(buyJump).toBeEnabled({ timeout: 5000 })
  await buyJump.click()
  await expect(page.getByTestId("shop-assign-jump")).toBeVisible({ timeout: 5000 })
  await page.getByTestId("shop-assign-jump").click()
  await page.getByTestId("shop-assign-jump-slot-1").click()

  await page.getByTestId("shop-close").click()
  await expect(page.getByTestId("shop-modal")).toBeHidden({ timeout: 5000 })
  await expect(page.getByTestId("ability-slot-1-charge-count")).toHaveText("4", {
    timeout: 5000,
  })
  await page.locator("body").focus()
}

/**
 * Casts fireball and verifies the heavy cooldown HUD tint/countdown.
 *
 * @param page - Playwright page.
 * @returns Captured cooldown evidence.
 */
export async function castFireballAndAssertCooldown(
  page: Page,
): Promise<{ kind: string | null; countdown: string | null }> {
  await page.mouse.move(700, 350)
  const overlay = page.getByTestId("ability-slot-0-cooldown-overlay")
  const countdown = page.getByTestId("ability-slot-0-cooldown-countdown")

  for (let attempt = 0; attempt < 4; attempt++) {
    await sendAbilitySlotInput(page, 0)
    const observed = await expect(overlay)
      .toHaveAttribute("data-cooldown-kind", "heavy", { timeout: 2500 })
      .then(async () => {
        await expect(countdown).toHaveText(/\d+/, { timeout: 500 })
        return true
      })
      .catch(() => false)
    if (observed) break
    await page.waitForTimeout(250)
  }

  await expect(overlay).toHaveAttribute("data-cooldown-kind", "heavy", {
    timeout: 500,
  })

  return {
    kind: await overlay.getAttribute("data-cooldown-kind"),
    countdown: await countdown.textContent(),
  }
}

/**
 * Spends jump until depleted and verifies the disabled cooldown HUD state.
 *
 * @param page - Playwright page.
 * @returns Captured depleted HUD evidence.
 */
export async function depleteJumpCharges(
  page: Page,
): Promise<{ charges: number; kind: string | null; countdown: string | null }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await readJumpCharges(page)
    if (before <= 0) break

    await spendOneJumpCharge(page, before)
    await page.waitForTimeout(900)
  }

  await expect
    .poll(async () => readJumpCharges(page), { timeout: 1000 })
    .toBe(0)

  const overlay = page.getByTestId("ability-slot-1-cooldown-overlay")
  await expect(overlay).toHaveAttribute("data-cooldown-kind", "heavy", {
    timeout: 1000,
  })
  const countdown = page.getByTestId("ability-slot-1-cooldown-countdown")
  await expect(countdown).toHaveText(/\d+/, { timeout: 1000 })

  return {
    charges: await readJumpCharges(page),
    kind: await overlay.getAttribute("data-cooldown-kind"),
    countdown: await countdown.textContent(),
  }
}

/**
 * Waits for one jump charge to return and verifies the usable recharging HUD state.
 *
 * @param page - Playwright page.
 * @returns Captured recharging HUD evidence.
 */
export async function assertJumpRechargeVisible(
  page: Page,
): Promise<{ charges: number; kind: string | null; countdown: string | null }> {
  await expect
    .poll(async () => readJumpCharges(page), {
      timeout: 7000,
      intervals: [100, 250, 500],
    })
    .toBeGreaterThanOrEqual(1)

  const overlay = page.getByTestId("ability-slot-1-cooldown-overlay")
  await expect(overlay).toHaveAttribute("data-cooldown-kind", "light", {
    timeout: 1000,
  })

  return {
    charges: await readJumpCharges(page),
    kind: await overlay.getAttribute("data-cooldown-kind"),
    countdown: await page.getByTestId("ability-slot-1-cooldown-countdown").textContent(),
  }
}
