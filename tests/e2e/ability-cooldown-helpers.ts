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
  await installAbilityCooldownStateRecorder(page)
  await pauseAutomaticPlayerInputs(page)
  await waitForAuthoritativeInputQueueIdle(page)
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
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          type PlayerRenderSystemLike = {
            update: (
              delta: number,
              keyboardInput: unknown,
              sendInput?: (input: unknown) => void,
              localInputForSimStep?: () => unknown,
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
          if (!arena || !playerRenderSystem) return false
          if (arena.__wwAbilityInputPauseInstalled) return true

          const originalUpdate = playerRenderSystem.update.bind(playerRenderSystem)
          playerRenderSystem.update = (delta, keyboardInput) => {
            originalUpdate(delta, keyboardInput, () => undefined)
          }
          arena.__wwAbilityInputPauseInstalled = true
          return true
        }),
      { timeout: 5_000, intervals: [50, 100, 150] },
    )
    .toBe(true)
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

type AbilityCooldownAuthoritativeState = {
  readonly id: number
  readonly playerId: string
  readonly lastProcessedInputSeq: number
  readonly castingAbilityId: string | null
  readonly animState: string
  readonly moveState: string
  readonly jumpZ: number
  readonly jumpCharges: number | null
  readonly syncCount: number
  readonly abilityStateVersion: number
  readonly lastAbilityStateSource: "full_sync" | "batch_update" | null
  readonly shopStateVersion: number
  readonly shopSlots: readonly (string | null)[]
}

/**
 * Tracks owner ACK state so E2E one-shot inputs can wait for server processing.
 *
 * @param page - Playwright page.
 */
async function installAbilityCooldownStateRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    type TrackedPlayer = {
      id: number
      playerId: string
      lastProcessedInputSeq: number
      castingAbilityId: string | null
      animState: string
      moveState: string
      jumpZ: number
      abilityStates?: {
        jump?: {
          charges?: number | null
        }
      }
      jumpCharges?: number | null
      abilityStateVersion?: number
      lastAbilityStateSource?: "full_sync" | "batch_update" | null
      shopStateVersion?: number
      shopSlots?: readonly (string | null)[]
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
      __wwAbilityCooldownRecorderInstalled?: boolean
      __wwAbilityCooldownState?: TrackedPlayer | null
      __wwAbilityCooldownSyncCount?: number
      __wwAbilityCooldownAbilityStateVersion?: number
      __wwAbilityCooldownShopStateVersion?: number
      __wwAbilityCooldownShopSlots?: readonly (string | null)[]
    }

    const w = globalThis as RecorderWindow
    const arena = w.__wwGame?.scene.getScene("Arena") as ArenaLike | null | undefined
    const connection = arena?.getConnection?.()
    const localPlayerId = arena?.getLocalPlayerId?.()
    if (!connection || !localPlayerId) {
      throw new Error("E2E ability recorder: game connection or local player missing")
    }

    if (!w.__wwAbilityCooldownRecorderInstalled) {
      w.__wwAbilityCooldownState = null
      w.__wwAbilityCooldownSyncCount = 0
      w.__wwAbilityCooldownAbilityStateVersion = 0
      w.__wwAbilityCooldownShopStateVersion = 0
      w.__wwAbilityCooldownShopSlots = []
      connection.onMessage((message) => {
        if (message.type === "SHOP_STATE") {
          const payload = message.payload as {
            abilitySlots?: readonly (string | null)[]
          }
          w.__wwAbilityCooldownShopStateVersion =
            (w.__wwAbilityCooldownShopStateVersion ?? 0) + 1
          w.__wwAbilityCooldownShopSlots = payload.abilitySlots ?? []
          if (w.__wwAbilityCooldownState) {
            w.__wwAbilityCooldownState = {
              ...w.__wwAbilityCooldownState,
              shopStateVersion: w.__wwAbilityCooldownShopStateVersion,
              shopSlots: w.__wwAbilityCooldownShopSlots,
            }
          }
          return
        }

        if (message.type === "GAME_STATE_SYNC") {
          w.__wwAbilityCooldownSyncCount = (w.__wwAbilityCooldownSyncCount ?? 0) + 1
          const payload = message.payload as { players?: readonly TrackedPlayer[] }
          const player = payload.players?.find((p) => p.playerId === localPlayerId)
          if (player) {
            w.__wwAbilityCooldownAbilityStateVersion =
              (w.__wwAbilityCooldownAbilityStateVersion ?? 0) + 1
            w.__wwAbilityCooldownState = {
              ...player,
              jumpCharges: player.abilityStates?.jump?.charges ?? null,
              syncCount: w.__wwAbilityCooldownSyncCount,
              abilityStateVersion: w.__wwAbilityCooldownAbilityStateVersion,
              lastAbilityStateSource: "full_sync",
              shopStateVersion: w.__wwAbilityCooldownShopStateVersion ?? 0,
              shopSlots: w.__wwAbilityCooldownShopSlots ?? [],
            }
          }
          return
        }

        if (message.type === "PLAYER_OWNER_ACK" && w.__wwAbilityCooldownState) {
          const payload = message.payload as {
            id: number
            playerId: string
            lastProcessedInputSeq: number
            replayContext?: Partial<
              Pick<TrackedPlayer, "castingAbilityId" | "jumpZ" | "moveState">
            >
          }
          if (payload.playerId === localPlayerId) {
            w.__wwAbilityCooldownState = {
              ...w.__wwAbilityCooldownState,
              id: payload.id,
              playerId: payload.playerId,
              lastProcessedInputSeq: payload.lastProcessedInputSeq,
              syncCount: w.__wwAbilityCooldownSyncCount ?? 0,
              ...(payload.replayContext?.castingAbilityId !== undefined
                ? { castingAbilityId: payload.replayContext.castingAbilityId }
                : {}),
              ...(payload.replayContext?.jumpZ !== undefined
                ? { jumpZ: payload.replayContext.jumpZ }
                : {}),
              ...(payload.replayContext?.moveState !== undefined
                ? { moveState: payload.replayContext.moveState }
                : {}),
              abilityStateVersion:
                w.__wwAbilityCooldownAbilityStateVersion ?? 0,
              shopStateVersion: w.__wwAbilityCooldownShopStateVersion ?? 0,
              shopSlots: w.__wwAbilityCooldownShopSlots ?? [],
            }
          }
          return
        }

        if (message.type !== "PLAYER_BATCH_UPDATE" || !w.__wwAbilityCooldownState) return
        const payload = message.payload as { deltas?: readonly Partial<TrackedPlayer>[] }
        const delta = payload.deltas?.find((d) => d.id === w.__wwAbilityCooldownState?.id)
        if (delta) {
          const hasAbilityStates = delta.abilityStates !== undefined
          if (hasAbilityStates) {
            w.__wwAbilityCooldownAbilityStateVersion =
              (w.__wwAbilityCooldownAbilityStateVersion ?? 0) + 1
          }
          w.__wwAbilityCooldownState = {
            ...w.__wwAbilityCooldownState,
            ...delta,
            jumpCharges:
              delta.abilityStates?.jump?.charges ??
              w.__wwAbilityCooldownState.jumpCharges ??
              null,
            syncCount: w.__wwAbilityCooldownSyncCount ?? 0,
            abilityStateVersion: w.__wwAbilityCooldownAbilityStateVersion ?? 0,
            lastAbilityStateSource: hasAbilityStates
              ? "batch_update"
              : w.__wwAbilityCooldownState.lastAbilityStateSource ?? null,
            shopStateVersion: w.__wwAbilityCooldownShopStateVersion ?? 0,
            shopSlots: w.__wwAbilityCooldownShopSlots ?? [],
          }
        }
      })
      w.__wwAbilityCooldownRecorderInstalled = true
    }

    connection.sendRequestResync?.()
  })

  await expect
    .poll(async () => (await readAbilityCooldownAuthoritativeState(page)) !== null, {
      timeout: 5_000,
    })
    .toBe(true)
}

/**
 * Reads the latest local authoritative state captured by the recorder.
 *
 * @param page - Playwright page.
 * @returns Latest state, or null before first sync.
 */
async function readAbilityCooldownAuthoritativeState(
  page: Page,
): Promise<AbilityCooldownAuthoritativeState | null> {
  return page.evaluate(() => {
    return (
      (globalThis as typeof globalThis & {
        __wwAbilityCooldownState?: AbilityCooldownAuthoritativeState | null
        __wwAbilityCooldownSyncCount?: number
      }).__wwAbilityCooldownState ?? null
    )
  })
}

/**
 * Waits for pre-pause automatic inputs to drain from the server queue.
 *
 * @param page - Playwright page.
 */
async function waitForAuthoritativeInputQueueIdle(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const before =
          (await readAbilityCooldownAuthoritativeState(page))?.lastProcessedInputSeq ??
          -1
        await page.waitForTimeout(300)
        const after =
          (await readAbilityCooldownAuthoritativeState(page))?.lastProcessedInputSeq ??
          -2
        return before >= 0 && before === after
      },
      { timeout: 6_000, intervals: [100, 200, 300] },
    )
    .toBe(true)
}

/**
 * Sends one ability-slot input through the live game connection.
 *
 * @param page - Playwright page.
 * @param slotIndex - Zero-based ability slot index.
 */
async function sendAbilitySlotInput(page: Page, slotIndex: number): Promise<number> {
  const minSeq =
    ((await readAbilityCooldownAuthoritativeState(page))?.lastProcessedInputSeq ?? 0) + 50
  return page.evaluate(({ abilitySlot, minimumSeq }) => {
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
    let seq = connection.nextSeq()
    while (seq < minimumSeq) {
      seq = connection.nextSeq()
    }
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
      seq,
      clientSendTimeMs: Date.now(),
    })
    return seq
  }, { abilitySlot: slotIndex, minimumSeq: minSeq })
}

/**
 * Sets server-authoritative jump runtime state through the E2E-only room hook.
 *
 * @param page - Playwright page.
 * @param charges - Jump charge count to expose in the HUD.
 * @param rechargeMs - Future recharge deadline for HUD countdown rendering.
 */
async function setJumpRuntime(
  page: Page,
  charges: number,
  rechargeMs: number,
): Promise<void> {
  const versionBefore =
    (await readAbilityCooldownAuthoritativeState(page))?.abilityStateVersion ?? 0
  await page.evaluate(({ nextCharges, nextRechargeMs }) => {
    type RoomLike = {
      send: (type: string, payload?: unknown) => void
    }
    type ConnectionLike = {
      room?: RoomLike | null
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
    const room = arena?.getConnection?.().room
    if (!room) throw new Error("E2E jump runtime: room missing")
    room.send("e2e_set_jump_runtime", {
      charges: nextCharges,
      rechargeMs: nextRechargeMs,
    })
  }, { nextCharges: charges, nextRechargeMs: rechargeMs })

  await expect
    .poll(
      async () => {
        const state = await readAbilityCooldownAuthoritativeState(page)
        return (
          state !== null &&
          state.abilityStateVersion > versionBefore &&
          state.jumpCharges === charges
        )
      },
      { timeout: 5_000, intervals: [50, 100, 150] },
    )
    .toBe(true)
}

/**
 * Waits for the server-confirmed shop state to show jump in slot 1.
 *
 * @param page - Playwright page.
 */
async function waitForJumpAssignedToSlotOne(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        (await readAbilityCooldownAuthoritativeState(page))?.shopSlots[1] ?? null,
      { timeout: 5_000, intervals: [50, 100, 150] },
    )
    .toBe("jump")
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
  await waitForJumpAssignedToSlotOne(page)
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
    const observed = await readCooldownEvidence(page, overlay, countdown, "heavy", 2500)
    if (observed) return observed
    await page.waitForTimeout(250)
  }

  await expect(overlay).toHaveAttribute("data-cooldown-kind", "heavy", {
    timeout: 500,
  })
  await expect(countdown).toHaveText(/\d+/, { timeout: 500 })
  return {
    kind: "heavy",
    countdown: await countdown.textContent().catch(() => null),
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
  await setJumpRuntime(page, 0, 5_000)

  await expect
    .poll(async () => readJumpCharges(page), { timeout: 2500, intervals: [50, 100, 150] })
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
 * Reads cooldown evidence as soon as both overlay kind and countdown are present.
 * Short cooldowns can disappear between a passing assertion and a later read on
 * slow CI runners, so capture the values in the same polling window.
 *
 * @param page - Playwright page.
 * @param overlay - Cooldown overlay locator.
 * @param countdown - Cooldown countdown locator.
 * @param expectedKind - Expected overlay kind.
 * @param timeoutMs - Maximum wait.
 * @returns Cooldown evidence, or null when not observed.
 */
async function readCooldownEvidence(
  page: Page,
  overlay: ReturnType<Page["getByTestId"]>,
  countdown: ReturnType<Page["getByTestId"]>,
  expectedKind: "heavy" | "light",
  timeoutMs: number,
): Promise<{ kind: string | null; countdown: string | null } | null> {
  const deadline = Date.now() + timeoutMs
  do {
    const [kind, label] = await Promise.all([
      overlay.getAttribute("data-cooldown-kind").catch(() => null),
      countdown.textContent().catch(() => null),
    ])
    if (kind === expectedKind && /\d+/.test(label ?? "")) {
      return { kind, countdown: label }
    }
    await page.waitForTimeout(50)
  } while (Date.now() < deadline)

  return null
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
  await setJumpRuntime(page, 1, 5_000)

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
