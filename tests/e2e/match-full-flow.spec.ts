import { test, expect } from "@playwright/test"
import { randomBytes } from "node:crypto"

import { ARENA_HEIGHT, ARENA_WIDTH } from "../../src/shared/balance-config/arena"
import {
  BASE_MOVE_SPEED_PX_PER_SEC,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
} from "../../src/shared/balance-config/combat"
import { ARENA_CAMERA_FOLLOW_ZOOM } from "../../src/shared/balance-config/rendering"
import {
  terrainStateAtPosition,
  worldCollidersForPlayerState,
} from "../../src/shared/collision/terrainHazards"
import { moveWithinWorld } from "../../src/shared/collision/worldCollision"

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
            g.textures.exists("triss") &&
            g.textures.exists("arena-base") &&
            g.anims.exists("lady-wizard-walk-south") &&
            g.anims.exists("lady-wizard-death-south") &&
            g.anims.exists("lady-wizard-light_spell_cast-south") &&
            g.anims.exists("lady-wizard-summoned_axe_swing-south") &&
            g.anims.exists("triss-walk-south") &&
            g.anims.exists("triss-death-south") &&
            g.anims.exists("triss-channel_fire-south") &&
            g.anims.exists("triss-big_blast-south")
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
      type CompactInputButtons = {
        buttons: number
        abilitySlot?: number
        useQuickItemSlot?: number
      }
      type PlayerInputCommandRun = CompactInputButtons & {
        fromSeq: number
        toSeq: number
      }
      type PlayerInputState = {
        protocolVersion: 2
        runs: PlayerInputCommandRun[]
      }
      type ConnectionLike = {
        sendPlayerInput: (input: PlayerInput) => void
        sendPlayerInputState: (input: PlayerInputState) => void
      }
      type ArenaLike = {
        getConnection?: () => ConnectionLike
      }
      const decodePlayerInputRun = (input: CompactInputButtons): PlayerInput => ({
        up: (input.buttons & 1) !== 0,
        down: (input.buttons & 2) !== 0,
        left: (input.buttons & 4) !== 0,
        right: (input.buttons & 8) !== 0,
        weaponPrimary: (input.buttons & 16) !== 0,
        weaponSecondary: (input.buttons & 32) !== 0,
        abilitySlot: input.abilitySlot ?? null,
        useQuickItemSlot: input.useQuickItemSlot ?? null,
      })
      const decodePlayerInputState = (input: PlayerInputState): PlayerInput[] => {
        return input.runs.flatMap((run) =>
          Array.from({ length: run.toSeq - run.fromSeq + 1 }, () =>
            decodePlayerInputRun(run),
          ),
        )
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
      const originalState = conn.sendPlayerInputState.bind(conn)
      w.__wwInputLog = []
      conn.sendPlayerInput = (input: PlayerInput) => {
        w.__wwInputLog?.push({ ...input })
        original(input)
      }
      conn.sendPlayerInputState = (input: PlayerInputState) => {
        w.__wwInputLog?.push(...decodePlayerInputState(input))
        originalState(input)
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

  type MovementProbe = {
    key: "w" | "s" | "a" | "d"
    label: string
    axis: "x" | "y"
    sign: -1 | 1
    dirX: -1 | 0 | 1
    dirY: -1 | 0 | 1
  }
  type MovementAttempt = MovementProbe & {
    startAxis: number
    endAxis: number
    projectedDelta: number
  }
  const MOVEMENT_PROBE_TICKS = 30
  const MOVEMENT_PROBE_DT_SEC = 1 / 60
  const MOVEMENT_PROBE_MIN_DELTA_PX = 48
  const movementProbes: MovementProbe[] = [
    { key: "w", label: "north", axis: "y", sign: -1, dirX: 0, dirY: -1 },
    { key: "s", label: "south", axis: "y", sign: 1, dirX: 0, dirY: 1 },
    { key: "a", label: "west", axis: "x", sign: -1, dirX: -1, dirY: 0 },
    { key: "d", label: "east", axis: "x", sign: 1, dirX: 1, dirY: 0 },
  ]
  const readAxis = (pos: { x: number; y: number }, axis: "x" | "y"): number =>
    axis === "x" ? pos.x : pos.y
  const simulateGroundMovementProbe = (
    start: { x: number; y: number },
    probe: MovementProbe,
  ): MovementAttempt => {
    let x = start.x
    let y = start.y
    const stepX = probe.dirX * BASE_MOVE_SPEED_PX_PER_SEC * MOVEMENT_PROBE_DT_SEC
    const stepY = probe.dirY * BASE_MOVE_SPEED_PX_PER_SEC * MOVEMENT_PROBE_DT_SEC

    for (let tick = 0; tick < MOVEMENT_PROBE_TICKS; tick++) {
      const terrainState = terrainStateAtPosition(x, y)
      const worldColliders = worldCollidersForPlayerState(0, terrainState)
      const resolved = moveWithinWorld(
        x,
        y,
        stepX,
        stepY,
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        { width: ARENA_WIDTH, height: ARENA_HEIGHT },
        worldColliders,
      )
      x = resolved.x
      y = resolved.y
    }

    const endAxis = readAxis({ x, y }, probe.axis)
    const startAxis = readAxis(start, probe.axis)
    return {
      ...probe,
      startAxis,
      endAxis,
      projectedDelta: (endAxis - startAxis) * probe.sign,
    }
  }

  const startPos = await readLocalPos()
  expect(startPos, "expected local render pos available before movement hold").not.toBeNull()
  const plannedMovementAttempts = movementProbes.map((probe) =>
    simulateGroundMovementProbe(startPos!, probe),
  )
  const movementProbe = plannedMovementAttempts.find(
    (attempt) => attempt.projectedDelta > MOVEMENT_PROBE_MIN_DELTA_PX,
  )
  expect(
    movementProbe,
    `expected one cardinal direction to be open from spawn: ${JSON.stringify(plannedMovementAttempts)}`,
  ).toBeTruthy()
  if (!movementProbe) throw new Error("expected an open movement direction")

  const probeMovement = async (probe: MovementProbe): Promise<MovementAttempt> => {
    await page.locator("body").focus()
    const startPos = await readLocalPos()
    expect(
      startPos,
      `expected local render pos available before ${probe.label} hold`,
    ).not.toBeNull()
    const startAxis = readAxis(startPos!, probe.axis)

    await page.keyboard.down(probe.key)
    try {
      await page.waitForTimeout(500)
    } finally {
      await page.keyboard.up(probe.key)
    }

    const endPos = await readLocalPos()
    expect(
      endPos,
      `expected local render pos available after ${probe.label} hold`,
    ).not.toBeNull()
    const endAxis = readAxis(endPos!, probe.axis)
    return {
      ...probe,
      startAxis,
      endAxis,
      projectedDelta: (endAxis - startAxis) * probe.sign,
    }
  }

  const movementResult = await probeMovement(movementProbe)

  // Any smoothing window overwriting prediction (pre-fix behavior) would leave
  // the local render static or moving backward while input is held. Some
  // shuffled no-cliff-lava spawns sit near props, so choose a direction that
  // shared collision math says has an open lane.
  expect(
    movementResult.projectedDelta,
    `expected local render to move ${movementResult.label}: ${JSON.stringify(movementResult)}`,
  ).toBeGreaterThan(4)

  // Post-release no-pull-back guard (cause B + C fix): after W is
  // released, the render should stay essentially still. Before the
  // fixed-step + retain-last-input fixes, any accumulated prediction
  // error would arm a smoothing window and visibly pull the render
  // back toward the ack target for ~80 ms. Sample twice after a short
  // settle to allow one smoothing window to expire, then confirm the
  // render does not drift backward (positive y delta) by more than a
  // small epsilon.
  await page.waitForTimeout(150)
  const settledPos = await readLocalPos()
  const settledAxis = settledPos ? readAxis(settledPos, movementResult.axis) : null
  await page.waitForTimeout(250)
  const afterSettlePos = await readLocalPos()
  const afterSettleAxis = afterSettlePos
    ? readAxis(afterSettlePos, movementResult.axis)
    : null
  expect(
    settledAxis,
    `expected local render pos available shortly after ${movementResult.label} release`,
  ).not.toBeNull()
  expect(
    afterSettleAxis,
    "expected local render pos available after post-release settle",
  ).not.toBeNull()
  expect(
    ((afterSettleAxis ?? 0) - (settledAxis ?? 0)) * movementResult.sign,
    `expected local render NOT to drift backward after ${movementResult.label} release (settled=${settledAxis}, afterSettle=${afterSettleAxis})`,
  ).toBeGreaterThan(-4)
  await expect(page.getByTestId("performance-issue-rubberbanding")).toHaveCount(0)

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
  await expect(page.getByTestId("performance-issue-rubberbanding")).toHaveCount(0)
})
