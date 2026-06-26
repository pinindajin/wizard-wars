import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { performance } from "node:perf_hooks"

import { describe, expect, it } from "vitest"

import { PlayerInputQueue } from "@/server/game/playerInputQueue"
import { sanitizePerfRunId } from "@/server/game/performanceConfig"
import type { PlayerInputPayload } from "@/shared/types"

const PLAYER_COUNT = 8
const INPUTS_PER_PLAYER = 2_048
const ROUNDS = 16

type QueueBenchmarkReport = {
  readonly runId: string
  readonly playerCount: number
  readonly inputsPerPlayer: number
  readonly rounds: number
  readonly arrayShift: {
    readonly totalMs: number
    readonly p95Ms: number
    readonly checksum: number
  }
  readonly deque: {
    readonly totalMs: number
    readonly p95Ms: number
    readonly checksum: number
    readonly maxBackingLengthAfterDrain: number
    readonly maxLogicalLengthAfterDrain: number
  }
}

function input(seq: number): PlayerInputPayload {
  return {
    up: true,
    down: false,
    left: false,
    right: false,
    abilitySlot: null,
    abilityTargetX: 0,
    abilityTargetY: 0,
    weaponPrimary: false,
    weaponSecondary: false,
    weaponTargetX: 100,
    weaponTargetY: 200,
    useQuickItemSlot: null,
    seq,
    clientSendTimeMs: seq,
  }
}

function buildInputs(): PlayerInputPayload[] {
  return Array.from({ length: INPUTS_PER_PLAYER }, (_, seq) => input(seq))
}

function percentile(samples: readonly number[], percentileValue: number): number {
  const sorted = [...samples].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  )
  return round(sorted[index] ?? 0)
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function measureArrayShift(): {
  readonly totalMs: number
  readonly p95Ms: number
  readonly checksum: number
} {
  const samples: number[] = []
  let totalMs = 0
  let checksum = 0
  for (let roundIndex = 0; roundIndex < ROUNDS; roundIndex += 1) {
    for (let playerIndex = 0; playerIndex < PLAYER_COUNT; playerIndex += 1) {
      const queue = buildInputs()
      const startedAt = performance.now()
      while (queue.length > 0) {
        checksum += queue.shift()!.seq
      }
      const elapsedMs = performance.now() - startedAt
      samples.push(elapsedMs)
      totalMs += elapsedMs
    }
  }
  return { totalMs: round(totalMs), p95Ms: percentile(samples, 95), checksum }
}

function measureDeque(): {
  readonly totalMs: number
  readonly p95Ms: number
  readonly checksum: number
  readonly maxBackingLengthAfterDrain: number
  readonly maxLogicalLengthAfterDrain: number
} {
  const samples: number[] = []
  let totalMs = 0
  let checksum = 0
  let maxBackingLengthAfterDrain = 0
  let maxLogicalLengthAfterDrain = 0
  for (let roundIndex = 0; roundIndex < ROUNDS; roundIndex += 1) {
    for (let playerIndex = 0; playerIndex < PLAYER_COUNT; playerIndex += 1) {
      const queue = new PlayerInputQueue(buildInputs())
      const startedAt = performance.now()
      let consumed = queue.consume()
      while (consumed !== undefined) {
        checksum += consumed.seq
        consumed = queue.consume()
      }
      const elapsedMs = performance.now() - startedAt
      samples.push(elapsedMs)
      totalMs += elapsedMs
      maxBackingLengthAfterDrain = Math.max(
        maxBackingLengthAfterDrain,
        queue.backingLengthForDiagnostics,
      )
      maxLogicalLengthAfterDrain = Math.max(maxLogicalLengthAfterDrain, queue.length)
    }
  }
  return {
    totalMs: round(totalMs),
    p95Ms: percentile(samples, 95),
    checksum,
    maxBackingLengthAfterDrain,
    maxLogicalLengthAfterDrain,
  }
}

function writeBenchmarkReport(report: QueueBenchmarkReport): string {
  const outDir = join(process.cwd(), "test-results", "perf-load")
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, `input-queue-deque-${report.runId}.json`)
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  return path
}

describe("input queue deque benchmark", () => {
  it("consumes 8 players x 2048 queued inputs without retained backing storage", () => {
    const runId =
      sanitizePerfRunId(process.env.WW_PERF_RUN_ID) ?? String(Date.now())
    const arrayShift = measureArrayShift()
    const deque = measureDeque()
    const report: QueueBenchmarkReport = {
      runId,
      playerCount: PLAYER_COUNT,
      inputsPerPlayer: INPUTS_PER_PLAYER,
      rounds: ROUNDS,
      arrayShift,
      deque,
    }

    writeBenchmarkReport(report)

    expect(deque.checksum).toBe(arrayShift.checksum)
    expect(deque.p95Ms).toBeLessThanOrEqual(
      arrayShift.p95Ms + Math.max(0.25, arrayShift.p95Ms * 0.25),
    )
    expect(deque.maxLogicalLengthAfterDrain).toBe(0)
    expect(deque.maxBackingLengthAfterDrain).toBeLessThanOrEqual(
      deque.maxLogicalLengthAfterDrain * 2,
    )
  })
})
