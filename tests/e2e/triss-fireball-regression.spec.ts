import { test, expect } from "@playwright/test"
import { randomBytes } from "node:crypto"

function uniqueUsername(): string {
  return `e2e_${randomBytes(6).toString("hex")}`
}

async function signupAndCreateLobby(page: import("@playwright/test").Page): Promise<void> {
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
}

async function waitForArenaReady(page: import("@playwright/test").Page): Promise<void> {
  await expect(page).toHaveURL(/\/lobby\/[^/]+\/game$/, { timeout: 60_000 })
  await expect(page.getByTestId("game-phaser-container").locator("canvas")).toBeVisible({
    timeout: 30_000,
  })
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          type WWGame = {
            textures: { exists: (key: string) => boolean }
            anims: { exists: (key: string) => boolean }
          }
          const game = (globalThis as unknown as { __wwGame?: WWGame }).__wwGame
          if (!game) return false
          return (
            game.textures.exists("triss") &&
            game.textures.exists("fireball") &&
            game.anims.exists("triss-channel_fire-south") &&
            game.anims.exists("fireball-fly")
          )
        }),
      { timeout: 60_000 },
    )
    .toBe(true)
  await expect(page.getByText(/HP/).first()).toBeVisible({ timeout: 30_000 })
  await page.locator("body").focus()
}

async function installFireballRecorder(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    type AnyMessage = {
      type: string
      payload: unknown
    }
    type ConnectionLike = {
      onMessage: (handler: (message: AnyMessage) => void) => () => void
    }
    type ArenaLike = {
      getConnection?: () => ConnectionLike
    }
    const game = (
      globalThis as unknown as {
        __wwGame?: { scene: { getScene: (key: string) => unknown } }
        __wwFireballLaunches?: unknown[]
        __wwFireballRecorderInstalled?: boolean
      }
    ).__wwGame
    const arena = game?.scene.getScene("Arena") as ArenaLike | undefined
    const connection = arena?.getConnection?.()
    if (!connection) throw new Error("Triss fireball recorder: GameConnection missing")

    const host = globalThis as unknown as {
      __wwFireballLaunches?: unknown[]
      __wwFireballRecorderInstalled?: boolean
    }
    host.__wwFireballLaunches = []
    if (host.__wwFireballRecorderInstalled) return
    connection.onMessage((message) => {
      if (message.type === "FIREBALL_LAUNCH") {
        host.__wwFireballLaunches?.push(message.payload)
      }
    })
    host.__wwFireballRecorderInstalled = true
  })
}

async function sendAbilitySlotInput(
  page: import("@playwright/test").Page,
  slotIndex: number,
): Promise<void> {
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
      playerRenderSystem?: {
        getLocalPlayerRenderPos?: () => { x: number; y: number } | null
      }
    }
    const game = (
      globalThis as unknown as {
        __wwGame?: { scene: { getScene: (key: string) => unknown } }
      }
    ).__wwGame
    const arena = game?.scene.getScene("Arena") as ArenaLike | undefined
    const connection = arena?.getConnection?.()
    const pos = arena?.playerRenderSystem?.getLocalPlayerRenderPos?.()
    if (!connection) throw new Error("Triss fireball input: GameConnection missing")
    if (!pos) throw new Error("Triss fireball input: local render position missing")
    connection.sendPlayerInput({
      up: false,
      down: false,
      left: false,
      right: false,
      abilitySlot,
      abilityTargetX: pos.x + 300,
      abilityTargetY: pos.y,
      weaponPrimary: false,
      weaponSecondary: false,
      weaponTargetX: pos.x + 300,
      weaponTargetY: pos.y,
      useQuickItemSlot: null,
      seq: connection.nextSeq(),
      clientSendTimeMs: Date.now(),
    })
  }, slotIndex)
}

async function countRenderedFireballs(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    type GameObjectLike = {
      texture?: { key?: string }
      active?: boolean
      visible?: boolean
    }
    type ArenaLike = {
      children?: { list?: GameObjectLike[] }
    }
    const game = (
      globalThis as unknown as {
        __wwGame?: { scene: { getScene: (key: string) => unknown } }
      }
    ).__wwGame
    const arena = game?.scene.getScene("Arena") as ArenaLike | undefined
    return (
      arena?.children?.list?.filter(
        (child) =>
          child.active !== false &&
          child.visible !== false &&
          child.texture?.key === "fireball",
      ).length ?? 0
    )
  })
}

test("Triss slot-0 fireball launches and renders after cast animation", async ({ page }) => {
  test.slow()
  test.setTimeout(180_000)

  await signupAndCreateLobby(page)
  await page.getByRole("button", { name: /triss/i }).click()
  await expect(page.getByText(/Triss/).first()).toBeVisible()

  const startBtn = page.getByRole("button", { name: /start game/i })
  await expect(startBtn).toBeEnabled({ timeout: 30_000 })
  await startBtn.click()
  await waitForArenaReady(page)
  await installFireballRecorder(page)

  for (let attempt = 0; attempt < 4; attempt++) {
    await sendAbilitySlotInput(page, 0)
    const observed = await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              (
                globalThis as unknown as {
                  __wwFireballLaunches?: unknown[]
                }
              ).__wwFireballLaunches?.length ?? 0,
          ),
        { timeout: 3000, intervals: [100, 200, 300] },
      )
      .toBeGreaterThan(0)
      .then(() => true)
      .catch(() => false)
    if (observed) break
    await page.waitForTimeout(300)
  }

  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (
              globalThis as unknown as {
                __wwFireballLaunches?: unknown[]
              }
            ).__wwFireballLaunches?.length ?? 0,
        ),
      { timeout: 500 },
    )
    .toBeGreaterThan(0)

  await expect
    .poll(async () => countRenderedFireballs(page), {
      timeout: 1000,
      intervals: [50, 100, 150],
    })
    .toBeGreaterThan(0)
})
