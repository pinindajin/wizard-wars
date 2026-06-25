import { describe, expect, it } from "vitest"

import type { ServerPerformanceStatusPayload } from "@/shared/types"

import {
  degradedStatusBudget,
  percentile,
  resolvePerfLoadReportPath,
  summarizePerfLoadRun,
} from "./perfLoadReport"

const baseStatus: ServerPerformanceStatusPayload = {
  serverTimeMs: 1_000,
  degraded: false,
  reasons: [],
  metrics: {
    windowMs: 1_000,
    droppedDebtMs: 0,
    catchUpCallbacks: 0,
    inputQueueDrops: 0,
    simDurationMs: 1,
    broadcastDurationMs: 1,
    eventLoopLagMs: 1,
    processCpuPercent: 12,
    heapUsedBytes: 1_000,
    rssBytes: 2_000,
    activeRooms: 1,
    connectedClients: 8,
  },
}

describe("perf-load report helpers", () => {
  it("computes percentile summaries and host-local metric deltas", () => {
    const stats = summarizePerfLoadRun({
      runId: " local:compact/8 ",
      scenarioId: "compact8",
      startedAtIso: "2026-06-25T00:00:00.000Z",
      endedAtIso: "2026-06-25T00:10:00.000Z",
      clientCount: 8,
      seconds: 600,
      inputRateHz: 60,
      transport: "compact",
      sentInputs: 100,
      ownerAcks: 90,
      playerBatches: 80,
      ackGapsMs: [10, 20, 30, 40, 100],
      playerBatchGapsMs: [5, 10, 20, 30, 50],
      statuses: [
        baseStatus,
        {
          ...baseStatus,
          serverTimeMs: 2_000,
          degraded: true,
          reasons: ["event_loop_lag", "broadcast_slow"],
          metrics: {
            ...baseStatus.metrics,
            inputQueueDrops: 0,
            heapUsedBytes: 1_500,
            rssBytes: 3_250,
            activeRooms: 1,
          },
        },
      ],
      activeRoomsAfterCleanup: 0,
    })

    expect(stats.runId).toBe("local_compact_8")
    expect(stats.ackGapP95Ms).toBe(100)
    expect(stats.ackGapP99Ms).toBe(100)
    expect(stats.playerBatchGapP95Ms).toBe(50)
    expect(stats.playerBatchGapP99Ms).toBe(50)
    expect(stats.inputQueueDrops).toBe(0)
    expect(stats.degradedReasonCounts).toEqual({
      broadcast_slow: 1,
      event_loop_lag: 1,
    })
    expect(stats.heapUsedDeltaBytes).toBe(500)
    expect(stats.rssDeltaBytes).toBe(1_250)
    expect(stats.activeRoomsAfterCleanup).toBe(0)
    expect(stats.activeRoomLeakDetected).toBe(false)
    expect(stats.diagnosticOnly).toBe(false)
  })

  it("uses strict scenario degradation budgets for long gates unless diagnostic-only is requested", () => {
    expect(
      degradedStatusBudget({
        seconds: 600,
        maxDegradedStatusCount: 1,
        diagnosticOnly: false,
      }),
    ).toBe(1)
    expect(
      degradedStatusBudget({
        seconds: 18_000,
        maxDegradedStatusCount: 1,
        diagnosticOnly: false,
      }),
    ).toBe(1)
    expect(
      degradedStatusBudget({
        seconds: 18_000,
        maxDegradedStatusCount: 1,
        diagnosticOnly: true,
      }),
    ).toBe(300)
  })

  it("builds deterministic run-id artifact paths", () => {
    expect(
      resolvePerfLoadReportPath({
        cwd: "/repo",
        runId: "local:compact/8",
        scenarioId: "compact8",
      }),
    ).toBe("/repo/test-results/perf-load/local_compact_8-compact8.json")
    expect(
      resolvePerfLoadReportPath({
        cwd: "/repo",
        runId: null,
        scenarioId: "compact8",
        startedAtMs: 123,
      }),
    ).toBe("/repo/test-results/perf-load/123-compact8.json")
  })

  it("computes nearest-rank percentiles with empty samples falling back to zero", () => {
    expect(percentile([], 95)).toBe(0)
    expect(percentile([5], 95)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5], 95)).toBe(5)
  })
})
