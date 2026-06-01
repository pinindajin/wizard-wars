import { expect, test, type Page } from "@playwright/test"

import { buyAndAssignJump, startSinglePlayerMatch } from "./ability-cooldown-helpers"

type TerrainState = "land" | "lava" | "cliff"

type AuthoritativePlayerState = {
  readonly id: number
  readonly playerId: string
  readonly x: number
  readonly y: number
  readonly terrainState: TerrainState
  readonly animState: string
  readonly moveState: string
  readonly jumpZ: number
  readonly lastProcessedInputSeq: number
}

type PlayerInputOverrides = Partial<{
  readonly up: boolean
  readonly down: boolean
  readonly left: boolean
  readonly right: boolean
  readonly abilitySlot: number | null
}>

const SMALL_LAVA_CENTER = { x: 352, y: 160 } as const
const SMALL_LAVA_RIGHT_EDGE_X = 384

/**
 * Installs a browser-side recorder for authoritative player snapshots/deltas.
 *
 * @param page - Playwright page hosting the live game.
 */
async function installAuthoritativeStateRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    type TrackedPlayer = {
      id: number
      playerId: string
      x: number
      y: number
      terrainState: "land" | "lava" | "cliff"
      animState: string
      moveState: string
      jumpZ: number
      lastProcessedInputSeq: number
    }
    type GameMessage = {
      type: string
      payload: unknown
    }
    type ConnectionLike = {
      onMessage: (handler: (message: GameMessage) => void) => () => void
      sendRequestResync?: () => void
    }
    type ArenaLike = {
      getConnection?: () => ConnectionLike
      getLocalPlayerId?: () => string | null
    }
    type RecorderWindow = typeof globalThis & {
      __wwGame?: { scene: { getScene: (key: string) => unknown } }
      __wwLavaJumpRecorderInstalled?: boolean
      __wwLavaJumpState?: TrackedPlayer | null
    }

    const w = globalThis as RecorderWindow
    const arena = w.__wwGame?.scene.getScene("Arena") as ArenaLike | null | undefined
    const connection = arena?.getConnection?.()
    const localPlayerId = arena?.getLocalPlayerId?.()
    if (!connection || !localPlayerId) {
      throw new Error("E2E lava recorder: game connection or local player missing")
    }

    if (!w.__wwLavaJumpRecorderInstalled) {
      w.__wwLavaJumpState = null
      connection.onMessage((message) => {
        if (message.type === "GAME_STATE_SYNC") {
          const payload = message.payload as {
            players?: readonly TrackedPlayer[]
          }
          const player = payload.players?.find((p) => p.playerId === localPlayerId)
          if (player) w.__wwLavaJumpState = { ...player }
          return
        }

        if (message.type !== "PLAYER_BATCH_UPDATE" || !w.__wwLavaJumpState) return
        const payload = message.payload as {
          deltas?: readonly Partial<TrackedPlayer>[]
        }
        const delta = payload.deltas?.find((d) => d.id === w.__wwLavaJumpState?.id)
        if (delta) {
          w.__wwLavaJumpState = { ...w.__wwLavaJumpState, ...delta }
        }
      })
      w.__wwLavaJumpRecorderInstalled = true
    }

    connection.sendRequestResync?.()
  })
}

/**
 * Reads the latest authoritative player state captured in the browser.
 *
 * @param page - Playwright page hosting the live game.
 * @returns Latest state, or null before the first sync.
 */
async function readAuthoritativeState(
  page: Page,
): Promise<AuthoritativePlayerState | null> {
  return page.evaluate(() => {
    return (
      (globalThis as typeof globalThis & {
        __wwLavaJumpState?: AuthoritativePlayerState | null
      }).__wwLavaJumpState ?? null
    )
  })
}

/**
 * Sends one authoritative input payload and returns its sequence number.
 *
 * @param page - Playwright page hosting the live game.
 * @param overrides - Movement or ability fields to override.
 * @returns Client input sequence number.
 */
async function sendPlayerInput(
  page: Page,
  overrides: PlayerInputOverrides,
): Promise<number> {
  return page.evaluate((inputOverrides) => {
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
    const arena = (
      globalThis as unknown as {
        __wwGame?: { scene: { getScene: (key: string) => unknown } }
      }
    ).__wwGame?.scene.getScene("Arena") as ArenaLike | null | undefined
    const connection = arena?.getConnection?.()
    if (!connection) throw new Error("E2E lava input: game connection missing")

    const seq = connection.nextSeq()
    connection.sendPlayerInput({
      up: false,
      down: false,
      left: false,
      right: false,
      abilitySlot: null,
      abilityTargetX: 700,
      abilityTargetY: 350,
      weaponPrimary: false,
      weaponSecondary: false,
      weaponTargetX: 700,
      weaponTargetY: 350,
      useQuickItemSlot: null,
      seq,
      clientSendTimeMs: Date.now(),
      ...inputOverrides,
    })
    return seq
  }, overrides)
}

/**
 * Waits until the server acknowledges an input sequence.
 *
 * @param page - Playwright page hosting the live game.
 * @param seq - Client input sequence number.
 */
async function waitForProcessedInput(page: Page, seq: number): Promise<void> {
  await expect
    .poll(async () => (await readAuthoritativeState(page))?.lastProcessedInputSeq ?? -1, {
      timeout: 5_000,
    })
    .toBeGreaterThanOrEqual(seq)
}

/**
 * Uses the E2E-only room hook to place the local player at a deterministic point.
 *
 * @param page - Playwright page hosting the live game.
 * @param x - World X coordinate.
 * @param y - World Y coordinate.
 */
async function setE2ePlayerPosition(
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate((pos) => {
    type ConnectionLike = {
      room?: { send: (type: string, payload: unknown) => void } | null
      sendRequestResync?: () => void
    }
    type ArenaLike = {
      getConnection?: () => ConnectionLike
    }
    const arena = (
      globalThis as unknown as {
        __wwGame?: { scene: { getScene: (key: string) => unknown } }
      }
    ).__wwGame?.scene.getScene("Arena") as ArenaLike | null | undefined
    const connection = arena?.getConnection?.()
    if (!connection?.room) throw new Error("E2E lava position: room missing")
    connection.room.send("e2e_set_player_position", pos)
    connection.sendRequestResync?.()
  }, { x, y })
}

/**
 * Waits for an authoritative local-player position near the expected point.
 *
 * @param page - Playwright page hosting the live game.
 * @param x - Expected world X coordinate.
 * @param y - Expected world Y coordinate.
 */
async function waitForAuthoritativePosition(
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = await readAuthoritativeState(page)
        if (!state) return false
        return Math.abs(state.x - x) < 1 && Math.abs(state.y - y) < 1
      },
      { timeout: 5_000 },
    )
    .toBe(true)
}

/**
 * Waits for the authoritative local player to report a terrain state.
 *
 * @param page - Playwright page hosting the live game.
 * @param terrainState - Expected terrain state.
 * @param timeout - Poll timeout in ms.
 * @returns Latest matching player state.
 */
async function waitForTerrain(
  page: Page,
  terrainState: TerrainState,
  timeout = 5_000,
): Promise<AuthoritativePlayerState> {
  await expect
    .poll(async () => (await readAuthoritativeState(page))?.terrainState ?? null, {
      timeout,
    })
    .toBe(terrainState)
  const state = await readAuthoritativeState(page)
  if (!state) throw new Error("E2E lava terrain: state missing after wait")
  return state
}

test("lava edge blocks WASD exit and Jump escapes to land", async ({ page }) => {
  test.slow()
  test.setTimeout(180_000)

  await startSinglePlayerMatch(page)
  await buyAndAssignJump(page)
  await installAuthoritativeStateRecorder(page)

  await setE2ePlayerPosition(page, SMALL_LAVA_CENTER.x, SMALL_LAVA_CENTER.y)
  await waitForAuthoritativePosition(page, SMALL_LAVA_CENTER.x, SMALL_LAVA_CENTER.y)
  await waitForTerrain(page, "lava")

  const moveRightSeq = await sendPlayerInput(page, { right: true })
  await waitForProcessedInput(page, moveRightSeq)
  await page.waitForTimeout(900)
  const stopRightSeq = await sendPlayerInput(page, { right: false })
  await waitForProcessedInput(page, stopRightSeq)

  const afterWalk = await waitForTerrain(page, "lava")
  expect(afterWalk.x).toBeLessThan(SMALL_LAVA_RIGHT_EDGE_X)

  await setE2ePlayerPosition(page, SMALL_LAVA_CENTER.x, SMALL_LAVA_CENTER.y)
  await waitForAuthoritativePosition(page, SMALL_LAVA_CENTER.x, SMALL_LAVA_CENTER.y)
  await waitForTerrain(page, "lava")

  const jumpSeq = await sendPlayerInput(page, { up: true, abilitySlot: 1 })
  await waitForProcessedInput(page, jumpSeq)
  await expect
    .poll(async () => (await readAuthoritativeState(page))?.jumpZ ?? 0, {
      timeout: 2_500,
    })
    .toBeGreaterThan(0)

  await expect
    .poll(
      async () => {
        const state = await readAuthoritativeState(page)
        return Boolean(state && state.terrainState === "land" && state.jumpZ <= 0)
      },
      { timeout: 8_000 },
    )
    .toBe(true)

  await sendPlayerInput(page, { up: false })
  const afterJump = await waitForTerrain(page, "land")
  expect(afterJump.y).toBeLessThan(SMALL_LAVA_CENTER.y)
})
