import { performance } from "node:perf_hooks"

import {
  Position,
} from "@/server/game/components"
import { createGameSimulation } from "@/server/game/simulation"
import {
  ARENA_SPAWN_POINTS,
  ARENA_WORLD_COLLIDERS,
} from "@/shared/balance-config/arena"
import {
  PLAYER_WORLD_COLLISION_FOOTPRINT,
} from "@/shared/balance-config/combat"
import type { PlayerInputPayload } from "@/shared/types"
import { ARENA_WORLD_COLLIDER_SET } from "@/shared/collision/arenaSpatialIndexes"
import { queryAabbIds } from "@/shared/collision/spatialIndex"

type BenchResult = {
  readonly scenario: string
  readonly ticks: number
  readonly medianTickMs: number
  readonly p95TickMs: number
  readonly avgCandidateCount: number
  readonly avgBruteForceCount: number
}

function input(seq: number, overrides: Partial<PlayerInputPayload> = {}): PlayerInputPayload {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    abilitySlot: null,
    abilityTargetX: 0,
    abilityTargetY: 0,
    weaponPrimary: false,
    weaponSecondary: false,
    weaponTargetX: 0,
    weaponTargetY: 0,
    useQuickItemSlot: null,
    seq,
    clientSendTimeMs: 0,
    ...overrides,
  }
}

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))
  return sorted[index] ?? 0
}

function summarize(
  scenario: string,
  samples: readonly number[],
  candidateCounts: readonly number[],
): BenchResult {
  const sorted = [...samples].sort((a, b) => a - b)
  const avgCandidateCount =
    candidateCounts.reduce((sum, count) => sum + count, 0) / Math.max(1, candidateCounts.length)
  return {
    scenario,
    ticks: samples.length,
    medianTickMs: Number(percentile(sorted, 0.5).toFixed(4)),
    p95TickMs: Number(percentile(sorted, 0.95).toFixed(4)),
    avgCandidateCount: Number(avgCandidateCount.toFixed(2)),
    avgBruteForceCount: ARENA_WORLD_COLLIDERS.length,
  }
}

function footprintQueryAabb(x: number, y: number) {
  const centerY = y + PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY
  return {
    x: x - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX,
    y: centerY - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusY,
    width: PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX * 2,
    height: PLAYER_WORLD_COLLISION_FOOTPRINT.radiusY * 2,
  }
}

function measureStaticQueries(
  scenario: string,
  points: readonly { readonly x: number; readonly y: number }[],
): BenchResult {
  const samples: number[] = []
  const candidateCounts: number[] = []
  for (let i = 0; i < 2_000; i++) {
    const point = points[i % points.length]!
    const startedAt = performance.now()
    const candidates = queryAabbIds(
      ARENA_WORLD_COLLIDER_SET.index,
      footprintQueryAabb(point.x, point.y),
      ARENA_WORLD_COLLIDER_SET.scratch,
    )
    samples.push(performance.now() - startedAt)
    candidateCounts.push(candidates.length)
  }
  return summarize(scenario, samples, candidateCounts)
}

function measureTwelvePlayerCap(): BenchResult {
  const sim = createGameSimulation(0)
  const ids: string[] = []
  for (let i = 0; i < 12; i++) {
    const userId = `p${i}`
    ids.push(userId)
    sim.addPlayer(userId, `Player ${i}`, "yen", i)
  }

  const samples: number[] = []
  const candidateCounts: number[] = []
  for (let tick = 0; tick < 2_000; tick++) {
    const queues = new Map<string, PlayerInputPayload[]>()
    for (const userId of ids) {
      queues.set(userId, [input(tick, { right: tick % 2 === 0 })])
    }
    const startedAt = performance.now()
    sim.tick(queues, tick * 16.667)
    samples.push(performance.now() - startedAt)
    for (const eid of sim.playerEntityMap.values()) {
      candidateCounts.push(
        queryAabbIds(
          ARENA_WORLD_COLLIDER_SET.index,
          footprintQueryAabb(Position.x[eid], Position.y[eid]),
          ARENA_WORLD_COLLIDER_SET.scratch,
        ).length,
      )
    }
  }
  return summarize("12-player cap", samples, candidateCounts)
}

function measureProjectileStressBaseline(): BenchResult {
  const sim = createGameSimulation(0)
  const ids: string[] = []
  for (let i = 0; i < 12; i++) {
    const userId = `p${i}`
    ids.push(userId)
    sim.addPlayer(userId, `Player ${i}`, "yen", i)
  }

  const samples: number[] = []
  const candidateCounts: number[] = []
  for (let tick = 0; tick < 2_000; tick++) {
    const queues = new Map<string, PlayerInputPayload[]>()
    for (let i = 0; i < ids.length; i++) {
      const spawn = ARENA_SPAWN_POINTS[i % ARENA_SPAWN_POINTS.length]!
      queues.set(ids[i]!, [
        input(tick, {
          abilitySlot: tick % 50 === 0 ? 0 : null,
          abilityTargetX: spawn.x + 800,
          abilityTargetY: spawn.y,
          weaponTargetX: spawn.x + 800,
          weaponTargetY: spawn.y,
        }),
      ])
    }
    const startedAt = performance.now()
    sim.tick(queues, tick * 16.667)
    samples.push(performance.now() - startedAt)
    candidateCounts.push(0)
  }
  return {
    ...summarize("projectile stress baseline", samples, candidateCounts),
    avgCandidateCount: 0,
    avgBruteForceCount: 0,
  }
}

const densePoints = ARENA_WORLD_COLLIDERS.slice(0, 20).map((rect) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
}))

const spreadPoints = ARENA_SPAWN_POINTS.map((point) => ({ x: point.x, y: point.y }))

const results = [
  measureStaticQueries("dense static-collider area", densePoints),
  measureStaticQueries("spread static-collider area", spreadPoints),
  measureTwelvePlayerCap(),
  measureProjectileStressBaseline(),
]

for (const result of results) {
  console.log(JSON.stringify(result))
}
