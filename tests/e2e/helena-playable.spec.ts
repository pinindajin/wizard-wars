import { expect, test, type Page } from "@playwright/test"
import { randomBytes } from "node:crypto"

function uniqueUsername(): string {
  return `e2e_${randomBytes(6).toString("hex")}`
}

async function signupAndCreateLobby(page: Page): Promise<void> {
  await page.goto("/signup")
  await page.locator("#signup-username").fill(uniqueUsername())
  await page.locator("#signup-password").fill("e2e-password-123")
  await Promise.all([
    page.waitForURL("**/home", { timeout: 15_000 }),
    page.getByRole("button", { name: /join the arena/i }).click(),
  ])
  await page.getByRole("button", { name: /browse games/i }).click()
  await page.getByRole("button", { name: /create lobby/i }).click()
  await page.waitForURL(/\/lobby\/[^/]+$/, { timeout: 30_000 })
}

async function waitForHelenaArena(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/lobby\/[^/]+\/game$/, { timeout: 60_000 })
  await expect(page.getByTestId("game-phaser-container").locator("canvas")).toBeVisible({
    timeout: 30_000,
  })
  await expect.poll(
    async () => page.evaluate(() => {
      type GameLike = {
        textures: { exists: (key: string) => boolean }
        anims: { exists: (key: string) => boolean }
        scene: { getScene: (key: string) => { children?: { list?: Array<{ texture?: { key?: string } }> } } }
      }
      const game = (globalThis as unknown as { __wwGame?: GameLike }).__wwGame
      if (!game) return false
      const arena = game.scene.getScene("Arena")
      return (
        game.textures.exists("helena") &&
        game.textures.exists("helena-energy-wave") &&
        game.anims.exists("helena-fire_spell-fireball-south") &&
        game.anims.exists("helena-spell_2-homing_orb-south") &&
        game.anims.exists("helena-spell_2-lightning_bolt-south") &&
        game.anims.exists("helena-spell_3-south") &&
        game.anims.exists("helena-stumble-south") &&
        game.anims.exists("helena-energy-wave-pulse") &&
        (arena.children?.list?.some((child) => child.texture?.key === "helena") ?? false)
      )
    }),
    { timeout: 60_000 },
  ).toBe(true)
  await expect(page.getByText(/^HP\b/i).first()).toBeVisible({ timeout: 30_000 })
}

async function sendPrimaryMelee(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Input = {
      up: boolean; down: boolean; left: boolean; right: boolean
      abilitySlot: null; abilityTargetX: number; abilityTargetY: number
      weaponPrimary: boolean; weaponSecondary: boolean
      weaponTargetX: number; weaponTargetY: number
      useQuickItemSlot: null; seq: number; clientSendTimeMs: number
    }
    type Connection = { nextSeq: () => number; sendPlayerInput: (input: Input) => void }
    type Arena = {
      getConnection?: () => Connection
      playerRenderSystem?: { getLocalPlayerRenderPos?: () => { x: number; y: number } | null }
    }
    const game = (globalThis as unknown as {
      __wwGame?: { scene: { getScene: (key: string) => Arena } }
    }).__wwGame
    const arena = game?.scene.getScene("Arena")
    const connection = arena?.getConnection?.()
    const pos = arena?.playerRenderSystem?.getLocalPlayerRenderPos?.()
    if (!connection || !pos) throw new Error("Helena melee E2E runtime not ready")
    connection.sendPlayerInput({
      up: false, down: false, left: false, right: false,
      abilitySlot: null,
      abilityTargetX: pos.x + 300,
      abilityTargetY: pos.y,
      weaponPrimary: true,
      weaponSecondary: false,
      weaponTargetX: pos.x + 300,
      weaponTargetY: pos.y,
      useQuickItemSlot: null,
      seq: connection.nextSeq(),
      clientSendTimeMs: Date.now(),
    })
  })
}

async function renderedWaveCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    type Child = { active?: boolean; texture?: { key?: string } }
    type Arena = { children?: { list?: Child[] } }
    const game = (globalThis as unknown as {
      __wwGame?: { scene: { getScene: (key: string) => Arena } }
    }).__wwGame
    return game?.scene.getScene("Arena").children?.list?.filter(
      (child) => child.active !== false && child.texture?.key === "helena-energy-wave",
    ).length ?? 0
  })
}

test("Helena is playable with requested clips and a self-cleaning energy wave", async ({ page }) => {
  test.slow()
  test.setTimeout(180_000)
  await signupAndCreateLobby(page)
  await page.getByRole("button", { name: /helena/i }).click()
  await expect(page.getByText(/Helena/).first()).toBeVisible()
  const start = page.getByRole("button", { name: /start game/i })
  await expect(start).toBeEnabled({ timeout: 30_000 })
  await start.click()
  await waitForHelenaArena(page)

  await sendPrimaryMelee(page)
  await expect.poll(() => renderedWaveCount(page), {
    timeout: 2_000,
    intervals: [25, 50, 75],
  }).toBeGreaterThan(0)
  await expect.poll(() => renderedWaveCount(page), { timeout: 2_000 }).toBe(0)
})
