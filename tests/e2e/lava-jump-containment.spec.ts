import { expect, test, type Page } from "@playwright/test"

import {
  ARENA_HEIGHT,
  ARENA_LAVA_COLLIDERS,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
} from "../../src/shared/balance-config"
import {
  JUMP_LANDING_GRACE_PX,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
} from "../../src/shared/balance-config/combat"
import { terrainColliderSetForPlayerState } from "../../src/shared/collision/arenaSpatialIndexes"
import { terrainStateAtPosition } from "../../src/shared/collision/terrainHazards"
import { canOccupyWorldPosition } from "../../src/shared/collision/worldCollision"
import { MAX_PLAYER_INPUT_COMMAND_RUN_SPAN_TICKS } from "../../src/shared/playerInputState"
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

type LavaEscapeSample = {
  readonly start: { readonly x: number; readonly y: number }
  readonly landThreshold: { readonly x: number; readonly y: number }
  readonly axis: "x" | "y"
  readonly direction: -1 | 1
  readonly input: PlayerInputOverrides
}

const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT } as const
const LAVA_TERRAIN_COLLIDER_SET = terrainColliderSetForPlayerState(0, "lava")
const HELD_INPUT_CHUNK_TICKS = MAX_PLAYER_INPUT_COMMAND_RUN_SPAN_TICKS

function sampleAxisValue(
  point: { readonly x: number; readonly y: number },
  sample: LavaEscapeSample,
): number {
  return sample.axis === "x" ? point.x : point.y
}

function isAtLandThresholdWithJumpGrace(
  point: { readonly x: number; readonly y: number },
  sample: LavaEscapeSample,
): boolean {
  const delta =
    sampleAxisValue(point, sample) - sampleAxisValue(sample.landThreshold, sample)
  return delta * sample.direction >= -JUMP_LANDING_GRACE_PX
}

function isAtOrPastLandThreshold(
  point: { readonly x: number; readonly y: number },
  sample: LavaEscapeSample,
): boolean {
  const delta =
    sampleAxisValue(point, sample) - sampleAxisValue(sample.landThreshold, sample)
  return delta * sample.direction >= 0
}

function assertNativeLavaEscapeSample(sample: LavaEscapeSample): LavaEscapeSample {
  const startIsValidLava =
    terrainStateAtPosition(sample.start.x, sample.start.y) === "lava" &&
    canOccupyWorldPosition(
      sample.start.x,
      sample.start.y,
      PLAYER_WORLD_COLLISION_FOOTPRINT,
      ARENA_BOUNDS,
      LAVA_TERRAIN_COLLIDER_SET.rects,
    )
  const landProbe = {
    x: sample.landThreshold.x + (sample.axis === "x" ? sample.direction * 8 : 0),
    y: sample.landThreshold.y + (sample.axis === "y" ? sample.direction * 8 : 0),
  }
  const thresholdIsValidLand =
    terrainStateAtPosition(landProbe.x, landProbe.y) === "land" &&
    canOccupyWorldPosition(
      landProbe.x,
      landProbe.y,
      PLAYER_WORLD_COLLISION_FOOTPRINT,
      ARENA_BOUNDS,
      ARENA_WORLD_COLLIDERS,
    )

  if (startIsValidLava && thresholdIsValidLand) return sample

  throw new Error(
    "Expected native arena geometry to contain the configured lava-to-land jump edge",
  )
}

function findNativeLavaEscapeSample(): LavaEscapeSample {
  const topLava = ARENA_LAVA_COLLIDERS.filter((rect) => rect.y === 0).sort(
    (a, b) => b.width - a.width,
  )[0]
  if (!topLava) throw new Error("Expected native arena geometry to contain top-edge lava")

  const startY = topLava.y + 24
  const landThresholdY = topLava.y + topLava.height + 16

  for (
    let x = topLava.x + PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX + 44;
    x < topLava.x + topLava.width - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX;
    x += 16
  ) {
    const sample = {
      start: { x, y: startY },
      landThreshold: { x, y: landThresholdY },
      axis: "y",
      direction: 1,
      input: { down: true },
    } as const satisfies LavaEscapeSample

    try {
      return assertNativeLavaEscapeSample(sample)
    } catch {
      continue
    }
  }

  throw new Error(
    "Expected native arena geometry to contain a reachable top lava-to-land jump edge",
  )
}

const LAVA_ESCAPE_SAMPLE = findNativeLavaEscapeSample()

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

        if (message.type === "PLAYER_OWNER_ACK" && w.__wwLavaJumpState) {
          const payload = message.payload as {
            id: number
            playerId: string
            x: number
            y: number
            lastProcessedInputSeq: number
            replayContext?: Partial<
              Pick<TrackedPlayer, "terrainState" | "moveState" | "jumpZ">
            >
          }
          if (payload.playerId === localPlayerId) {
            w.__wwLavaJumpState = {
              ...w.__wwLavaJumpState,
              id: payload.id,
              playerId: payload.playerId,
              x: payload.x,
              y: payload.y,
              lastProcessedInputSeq: payload.lastProcessedInputSeq,
              ...(payload.replayContext?.terrainState !== undefined
                ? { terrainState: payload.replayContext.terrainState }
                : {}),
              ...(payload.replayContext?.moveState !== undefined
                ? { moveState: payload.replayContext.moveState }
                : {}),
              ...(payload.replayContext?.jumpZ !== undefined
                ? { jumpZ: payload.replayContext.jumpZ }
                : {}),
            }
          }
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
 * Sends held input as a compact fixed-tick command run.
 *
 * @param page - Playwright page hosting the live game.
 * @param input - Held movement fields to encode.
 * @param tickCount - Number of simulation ticks covered by the run.
 * @returns Last client input sequence covered by the run.
 */
async function sendHeldInputRun(
  page: Page,
  input: PlayerInputOverrides,
  tickCount: number,
): Promise<number> {
  return page.evaluate(
    ({ inputOverrides, maxRunTicks, ticks }) => {
      type PlayerInputCommandRun = {
        fromSeq: number
        toSeq: number
        clientSendTimeMs: number
        buttons: number
        targetX: number
        targetY: number
      }
      type PlayerInputState = {
        protocolVersion: 2
        runs: readonly PlayerInputCommandRun[]
      }
      type ConnectionLike = {
        nextSeq: () => number
        sendPlayerInputState: (input: PlayerInputState) => void
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

      const buttons =
        (inputOverrides.up ? 1 : 0) |
        (inputOverrides.down ? 2 : 0) |
        (inputOverrides.left ? 4 : 0) |
        (inputOverrides.right ? 8 : 0)
      const runs: PlayerInputCommandRun[] = []
      let ticksRemaining = ticks
      let latestSeq = -1

      while (ticksRemaining > 0) {
        const runTicks = Math.min(maxRunTicks, ticksRemaining)
        let fromSeq = -1
        let toSeq = -1
        for (let i = 0; i < runTicks; i += 1) {
          const seq = connection.nextSeq()
          if (i === 0) fromSeq = seq
          toSeq = seq
        }
        latestSeq = toSeq
        runs.push({
          fromSeq,
          toSeq,
          clientSendTimeMs: Date.now(),
          buttons,
          targetX: 700,
          targetY: 350,
        })
        ticksRemaining -= runTicks
      }

      connection.sendPlayerInputState({
        protocolVersion: 2,
        runs,
      })
      return latestSeq
    },
    {
      inputOverrides: input,
      maxRunTicks: MAX_PLAYER_INPUT_COMMAND_RUN_SPAN_TICKS,
      ticks: tickCount,
    },
  )
}

/**
 * Sends held input in compact fixed-tick chunks.
 *
 * @param page - Playwright page hosting the live game.
 * @param input - Held movement or action fields to resend.
 * @param done - Completion predicate checked after each authoritative ACK.
 * @param timeout - Max wait in milliseconds.
 * @returns Latest state satisfying the predicate.
 */
async function sendHeldInputUntil(
  page: Page,
  input: PlayerInputOverrides,
  done: (state: AuthoritativePlayerState) => boolean,
  timeout = 8_000,
): Promise<AuthoritativePlayerState> {
  const deadline = Date.now() + timeout
  let lastState: AuthoritativePlayerState | null = null
  while (Date.now() < deadline) {
    const seq = await sendHeldInputRun(page, input, HELD_INPUT_CHUNK_TICKS)
    await waitForProcessedInput(page, seq)
    lastState = await readAuthoritativeState(page)
    if (lastState && done(lastState)) return lastState
  }
  throw new Error(
    `Timed out waiting for held input condition; lastState=${JSON.stringify(lastState)}`,
  )
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

test("lava edge allows WASD exit and Jump still escapes to land", async ({ page }) => {
  test.slow()
  test.setTimeout(180_000)

  await startSinglePlayerMatch(page)
  await buyAndAssignJump(page)
  await installAuthoritativeStateRecorder(page)

  await setE2ePlayerPosition(
    page,
    LAVA_ESCAPE_SAMPLE.start.x,
    LAVA_ESCAPE_SAMPLE.start.y,
  )
  await waitForAuthoritativePosition(
    page,
    LAVA_ESCAPE_SAMPLE.start.x,
    LAVA_ESCAPE_SAMPLE.start.y,
  )
  await waitForTerrain(page, "lava")

  const afterWalk = await sendHeldInputUntil(
    page,
    LAVA_ESCAPE_SAMPLE.input,
    (state) =>
      state.terrainState === "land" &&
      isAtOrPastLandThreshold(state, LAVA_ESCAPE_SAMPLE),
  )
  const stopRightSeq = await sendPlayerInput(page, { right: false })
  await waitForProcessedInput(page, stopRightSeq)

  expect(isAtOrPastLandThreshold(afterWalk, LAVA_ESCAPE_SAMPLE)).toBe(true)
  expect(afterWalk.animState).not.toBe("stumble")

  await setE2ePlayerPosition(
    page,
    LAVA_ESCAPE_SAMPLE.start.x,
    LAVA_ESCAPE_SAMPLE.start.y,
  )
  await waitForAuthoritativePosition(
    page,
    LAVA_ESCAPE_SAMPLE.start.x,
    LAVA_ESCAPE_SAMPLE.start.y,
  )
  await waitForTerrain(page, "lava")

  const jumpSeq = await sendPlayerInput(page, {
    ...LAVA_ESCAPE_SAMPLE.input,
    abilitySlot: 1,
  })
  await waitForProcessedInput(page, jumpSeq)
  await expect
    .poll(async () => (await readAuthoritativeState(page))?.jumpZ ?? 0, {
      timeout: 2_500,
    })
    .toBeGreaterThan(0)

  const afterJump = await sendHeldInputUntil(
    page,
    LAVA_ESCAPE_SAMPLE.input,
    (state) =>
      state.terrainState === "land" &&
      state.jumpZ <= 0 &&
      isAtLandThresholdWithJumpGrace(state, LAVA_ESCAPE_SAMPLE),
  )
  const stopJumpSeq = await sendPlayerInput(page, { right: false })
  await waitForProcessedInput(page, stopJumpSeq)
  expect(isAtLandThresholdWithJumpGrace(afterJump, LAVA_ESCAPE_SAMPLE)).toBe(true)
  expect(afterJump.animState).not.toBe("stumble")
})
