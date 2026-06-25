import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { performance } from "node:perf_hooks"

import type { Room } from "@colyseus/sdk"
import { afterEach, describe, expect, it } from "vitest"

import { PlayerInputStateScheduler } from "@/game/network/PlayerInputStateScheduler"
import { playerLobbyIndex } from "@/server/colyseus/rooms/GameLobbyRoom"
import { sanitizePerfRunId } from "@/server/game/performanceConfig"
import { RoomEvent } from "@/shared/roomEvents"
import type {
  LobbyStatePayload,
  PlayerInputPayload,
  ServerPerformanceStatusPayload,
} from "@/shared/types"

import {
  bootTestServer,
  createTestToken,
  delay,
  shutdownTestServer,
  type TestServer,
} from "../integration/helpers/colyseus-test-server"

type PerfLoadScenario = {
  readonly id: string
  readonly clientCount: number
  readonly seconds: number
  readonly inputRateHz: number
  readonly transport: "compact" | "legacy"
  readonly maxAckGapMs: number
  readonly maxPlayerBatchGapMs: number
  readonly maxDegradedStatusCount: number
}

type PerfLoadStats = {
  readonly runId: string | null
  readonly scenarioId: string
  readonly startedAtIso: string
  readonly endedAtIso: string
  readonly clientCount: number
  readonly seconds: number
  readonly inputRateHz: number
  readonly transport: string
  readonly sentInputs: number
  readonly ownerAcks: number
  readonly playerBatches: number
  readonly maxAckGapMs: number
  readonly maxPlayerBatchGapMs: number
  readonly statusCount: number
  readonly degradedStatusCount: number
  readonly degradedStatusBudget: number
  readonly degradedReasons: readonly string[]
  readonly lastStatus: ServerPerformanceStatusPayload | null
}

const DEFAULT_CLIENTS = 8
const DEFAULT_SECONDS = 10
const DEFAULT_INPUT_RATE_HZ = 60
const NOOP_ROOM_EVENTS = Object.values(RoomEvent)

const SCENARIOS: Record<string, Omit<PerfLoadScenario, "clientCount" | "seconds" | "inputRateHz">> = {
  compact8: {
    id: "compact8",
    transport: "compact",
    maxAckGapMs: 250,
    maxPlayerBatchGapMs: 300,
    maxDegradedStatusCount: 1,
  },
  "legacy60-burst": {
    id: "legacy60-burst",
    transport: "legacy",
    maxAckGapMs: 250,
    maxPlayerBatchGapMs: 300,
    maxDegradedStatusCount: 1,
  },
}

let server: TestServer | null = null

afterEach(async () => {
  playerLobbyIndex.clear()
  if (server) {
    await shutdownTestServer(server)
    server = null
  }
})

describe("Colyseus perf load", () => {
  for (const scenario of selectedScenarios()) {
    it(
      `keeps ${scenario.clientCount} clients healthy in ${scenario.id}`,
      async () => {
        server = await bootTestServer()
        const rooms = await createStartedRoom(server, scenario.clientCount)
        try {
          const stats = await runScenario(rooms, scenario)

          writeReport(stats)

          expect(stats.sentInputs).toBeGreaterThan(0)
          expect(stats.ownerAcks).toBeGreaterThan(0)
          expect(stats.playerBatches).toBeGreaterThan(0)
          expect(stats.degradedStatusCount).toBeLessThanOrEqual(
            stats.degradedStatusBudget,
          )
          expect(stats.maxAckGapMs).toBeLessThanOrEqual(scenario.maxAckGapMs)
          expect(stats.maxPlayerBatchGapMs).toBeLessThanOrEqual(
            scenario.maxPlayerBatchGapMs,
          )
        } finally {
          await leaveRoomsBestEffort(rooms)
        }
      },
    )
  }
})

function selectedScenarios(): PerfLoadScenario[] {
  const ids = (process.env.WW_PERF_LOAD_SCENARIOS ?? "compact8")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

  return ids.map((id) => {
    const base = SCENARIOS[id]
    if (!base) throw new Error(`Unknown WW_PERF_LOAD_SCENARIOS id: ${id}`)
    return {
      ...base,
      clientCount: readPositiveInt("WW_PERF_LOAD_CLIENTS", DEFAULT_CLIENTS),
      seconds: readPositiveInt("WW_PERF_LOAD_SECONDS", DEFAULT_SECONDS),
      inputRateHz: readPositiveInt("WW_PERF_LOAD_INPUT_HZ", DEFAULT_INPUT_RATE_HZ),
    }
  })
}

async function createStartedRoom(
  activeServer: TestServer,
  clientCount: number,
): Promise<Room[]> {
  playerLobbyIndex.clear()
  const tokens = await Promise.all(
    Array.from({ length: clientCount }, (_, index) =>
      createTestToken(`perf-user-${index + 1}`, `PerfUser${index + 1}`),
    ),
  )
  const host = await activeServer.sdk.create("game_lobby", { token: tokens[0] })
  registerNoopRoomHandlers(host)
  const rooms = [host]
  let latestState: LobbyStatePayload | null = null
  let syncCount = 0

  host.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
    latestState = state
  })

  for (let index = 1; index < clientCount; index += 1) {
    const guest = await activeServer.sdk.joinById(host.roomId, { token: tokens[index] })
    registerNoopRoomHandlers(guest)
    rooms.push(guest)
  }

  for (const room of rooms) {
    room.onMessage(RoomEvent.GameStateSync, () => {
      syncCount += 1
    })
    room.onMessage("*", () => undefined)
  }

  await waitFor(
    () => latestState?.players.length === clientCount,
    `all ${clientCount} clients joined`,
    5_000,
  )

  host.send(RoomEvent.LobbyStartGame, {})
  await waitFor(
    () => latestState?.phase === "WAITING_FOR_CLIENTS",
    "room entered WAITING_FOR_CLIENTS",
    5_000,
  )

  for (const room of rooms) {
    room.send(RoomEvent.ClientSceneReady, {})
  }

  await waitFor(
    () => latestState?.phase === "IN_PROGRESS" && syncCount >= clientCount,
    "room entered IN_PROGRESS and synced clients",
    12_000,
  )

  return rooms
}

async function runScenario(
  rooms: readonly Room[],
  scenario: PerfLoadScenario,
): Promise<PerfLoadStats> {
  const ownerAckCounts = new Array(rooms.length).fill(0) as number[]
  const playerBatchCounts = new Array(rooms.length).fill(0) as number[]
  const lastAckAtMs = new Array(rooms.length).fill(0) as number[]
  const lastPlayerBatchAtMs = new Array(rooms.length).fill(0) as number[]
  let maxAckGapMs = 0
  let maxPlayerBatchGapMs = 0
  const statusesByServerTimeMs = new Map<number, ServerPerformanceStatusPayload>()

  rooms.forEach((room, index) => {
    room.onMessage(RoomEvent.PlayerOwnerAck, () => {
      const now = performance.now()
      if (lastAckAtMs[index] > 0) {
        maxAckGapMs = Math.max(maxAckGapMs, now - lastAckAtMs[index])
      }
      lastAckAtMs[index] = now
      ownerAckCounts[index] += 1
    })
    room.onMessage(RoomEvent.PlayerBatchUpdate, () => {
      const now = performance.now()
      if (lastPlayerBatchAtMs[index] > 0) {
        maxPlayerBatchGapMs = Math.max(
          maxPlayerBatchGapMs,
          now - lastPlayerBatchAtMs[index],
        )
      }
      lastPlayerBatchAtMs[index] = now
      playerBatchCounts[index] += 1
    })
    room.onMessage(
      RoomEvent.ServerPerformanceStatus,
      (payload: ServerPerformanceStatusPayload) => {
        statusesByServerTimeMs.set(payload.serverTimeMs, payload)
      },
    )
  })

  const schedulers = rooms.map(() => new PlayerInputStateScheduler())
  const seqByClient = rooms.map(() => 0)
  const startedAtPerfMs = performance.now()
  const startedAtIso = new Date().toISOString()
  const endsAtPerfMs = startedAtPerfMs + scenario.seconds * 1_000
  const intervalMs = 1_000 / scenario.inputRateHz
  let nextTickAtPerfMs = startedAtPerfMs
  let tick = 0
  let sentInputs = 0

  while (performance.now() < endsAtPerfMs) {
    const nowMs = Date.now()
    rooms.forEach((room, clientIndex) => {
      const input = buildInput(clientIndex, tick, seqByClient[clientIndex]++, nowMs)
      if (scenario.transport === "compact") {
        const state = schedulers[clientIndex]!.maybeBuildState(input, nowMs)
        if (state) {
          room.send(RoomEvent.PlayerInputState, state)
          sentInputs += 1
        }
      } else {
        room.send(RoomEvent.PlayerInput, input)
        sentInputs += 1
      }
    })

    tick += 1
    nextTickAtPerfMs += intervalMs
    await delay(Math.max(0, nextTickAtPerfMs - performance.now()))
  }

  await delay(500)

  const statuses = [...statusesByServerTimeMs.values()]
  const degradedStatuses = statuses.filter((status) => status.degraded)
  return {
    runId: sanitizePerfRunId(process.env.WW_PERF_RUN_ID),
    scenarioId: scenario.id,
    startedAtIso,
    endedAtIso: new Date().toISOString(),
    clientCount: scenario.clientCount,
    seconds: scenario.seconds,
    inputRateHz: scenario.inputRateHz,
    transport: scenario.transport,
    sentInputs,
    ownerAcks: ownerAckCounts.reduce((sum, count) => sum + count, 0),
    playerBatches: playerBatchCounts.reduce((sum, count) => sum + count, 0),
    maxAckGapMs,
    maxPlayerBatchGapMs,
    statusCount: statuses.length,
    degradedStatusCount: degradedStatuses.length,
    degradedStatusBudget: degradedStatusBudget(scenario),
    degradedReasons: [...new Set(degradedStatuses.flatMap((status) => status.reasons))],
    lastStatus: statuses.at(-1) ?? null,
  }
}

/**
 * Returns the allowed degraded status count for one host-local perf run.
 *
 * @param scenario - Scenario under test.
 * @returns Absolute degraded status budget.
 */
function degradedStatusBudget(scenario: PerfLoadScenario): number {
  if (scenario.seconds <= 10) return scenario.maxDegradedStatusCount
  return Math.max(scenario.maxDegradedStatusCount, Math.ceil(scenario.seconds / 60))
}

function registerNoopRoomHandlers(room: Room): void {
  for (const event of NOOP_ROOM_EVENTS) {
    room.onMessage(event, () => undefined)
  }
}

/**
 * Best-effort client cleanup for long perf runs.
 *
 * Colyseus SDK `leave()` can wait indefinitely for an onLeave round trip after
 * the room is already closing. Server shutdown is handled by afterEach, so this
 * helper only gives clients a bounded chance to leave gracefully.
 *
 * @param rooms - Connected Colyseus SDK rooms to leave.
 */
async function leaveRoomsBestEffort(rooms: readonly Room[]): Promise<void> {
  await Promise.all(rooms.map((room) => leaveRoomBestEffort(room)))
}

/**
 * Attempts one SDK leave without letting cleanup outlive the perf test budget.
 *
 * @param room - Connected Colyseus SDK room.
 */
async function leaveRoomBestEffort(room: Room): Promise<void> {
  const leave = room.leave().catch(() => undefined)
  await Promise.race([leave, delay(1_000)])
}

function buildInput(
  clientIndex: number,
  tick: number,
  seq: number,
  nowMs: number,
): PlayerInputPayload {
  const direction = Math.floor((tick + clientIndex * 11) / 45) % 4
  const weaponPrimary = tick % 90 < 18
  const shouldCastFireball = tick % 180 === (clientIndex * 9) % 180
  const targetX = 704 + Math.cos((clientIndex / 8) * Math.PI * 2) * 240
  const targetY = 560 + Math.sin((clientIndex / 8) * Math.PI * 2) * 180

  return {
    up: direction === 0,
    down: direction === 2,
    left: direction === 3,
    right: direction === 1,
    abilitySlot: shouldCastFireball ? 0 : null,
    abilityTargetX: targetX,
    abilityTargetY: targetY,
    weaponPrimary,
    weaponSecondary: false,
    weaponTargetX: targetX,
    weaponTargetY: targetY,
    useQuickItemSlot: null,
    seq,
    clientSendTimeMs: nowMs,
  }
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return
    await delay(25)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function writeReport(stats: PerfLoadStats): void {
  const dir = join(process.cwd(), "test-results", "perf-load")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${Date.now()}-${stats.scenarioId}.json`),
    `${JSON.stringify(stats, null, 2)}\n`,
    "utf8",
  )
}
