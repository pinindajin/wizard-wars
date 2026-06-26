import { describe, expect, it } from "vitest"

import {
  PERFORMANCE_ISSUE_ORDER,
  SERVER_DROPPED_DEBT_DIAGNOSTIC_THRESHOLD_MS,
  SERVER_EVENT_LOOP_LAG_DIAGNOSTIC_THRESHOLD_MS,
  classifyServerPerformance,
  createRubberbandState,
  isAuthoritativeMessageStale,
  isRubberbanding,
  recordRubberbandCorrection,
  serverPerformanceStatusKey,
  type ServerPerformanceMetrics,
} from "./performanceIndicators"

function serverMetrics(
  overrides: Partial<ServerPerformanceMetrics> = {},
): ServerPerformanceMetrics {
  return {
    windowMs: 1_000,
    droppedDebtMs: 0,
    catchUpCallbacks: 0,
    inputQueueDrops: 0,
    simDurationMs: 35,
    broadcastDurationMs: 8,
    roomTickDurationMs: 40,
    visualFlushDurationMs: 4,
    ownerAckSendDurationMs: 4,
    immediateBroadcastDurationMs: 1,
    processEventLoopDelayMs: 12,
    processEventLoopDelayP95Ms: 4,
    eventLoopLagMs: 4,
    eventLoopLagP95Ms: 4,
    processCpuPercent: 18,
    heapUsedBytes: 1024,
    rssBytes: 2048,
    activeRooms: 1,
    connectedClients: 8,
    ...overrides,
  }
}

describe("performance indicator helpers", () => {
  it("keeps the Seas warning icon priority order", () => {
    expect(PERFORMANCE_ISSUE_ORDER).toEqual([
      "lost_connection",
      "server_cpu",
      "rubberbanding",
    ])
  })

  it("activates rubberbanding on a snap and clears after a clean period", () => {
    let state = createRubberbandState()
    state = recordRubberbandCorrection(state, "snap", 1_000)

    expect(isRubberbanding(state, 1_001)).toBe(true)
    expect(isRubberbanding(state, 3_999)).toBe(true)
    expect(isRubberbanding(state, 4_001)).toBe(false)
  })

  it("activates rubberbanding after three smooth corrections in a rolling window", () => {
    let state = createRubberbandState()
    state = recordRubberbandCorrection(state, "smooth", 1_000)
    state = recordRubberbandCorrection(state, "smooth", 2_000)
    expect(isRubberbanding(state, 2_000)).toBe(false)

    state = recordRubberbandCorrection(state, "smooth", 3_000)
    expect(isRubberbanding(state, 3_000)).toBe(true)
  })

  it("ignores smooth corrections spread outside the rolling window", () => {
    let state = createRubberbandState()
    state = recordRubberbandCorrection(state, "smooth", 1_000)
    state = recordRubberbandCorrection(state, "smooth", 2_000)
    state = recordRubberbandCorrection(state, "smooth", 6_500)

    expect(isRubberbanding(state, 6_500)).toBe(false)
  })

  it("detects stale authoritative messages", () => {
    expect(isAuthoritativeMessageStale(1_000, 5_999)).toBe(false)
    expect(isAuthoritativeMessageStale(1_000, 6_000)).toBe(true)
  })

  it("classifies server loop degradation reasons in stable order", () => {
    const overloaded = classifyServerPerformance({
      windowMs: 1_000,
      droppedDebtMs: 16.67,
      catchUpCallbacks: 2,
      inputQueueDrops: 1,
      simDurationMs: 4,
      broadcastDurationMs: 75,
      roomTickDurationMs: 8,
      visualFlushDurationMs: 2,
      ownerAckSendDurationMs: 1,
      immediateBroadcastDurationMs: 4,
      processEventLoopDelayMs: 25,
      processEventLoopDelayP95Ms: 20,
      eventLoopUtilization: 0.5,
      gcPauseMs: 3,
      eventLoopLagMs: 25,
      eventLoopLagP95Ms: 20,
      processCpuPercent: 95,
      heapUsedBytes: 1024,
      rssBytes: 2048,
      activeRooms: 1,
      connectedClients: 1,
    })

    expect(overloaded).toEqual({
      degraded: true,
      reasons: [
        "dropped_debt",
        "catch_up",
        "input_queue_drops",
        "event_loop_lag",
        "broadcast_slow",
      ],
    })
    expect(serverPerformanceStatusKey(overloaded)).toBe(
      "dropped_debt|catch_up|input_queue_drops|event_loop_lag|broadcast_slow",
    )
  })

  it("ignores isolated max loop-lag spikes when the sustained p95 lag is healthy", () => {
    expect(
      classifyServerPerformance(serverMetrics({
        eventLoopLagMs: 25,
        eventLoopLagP95Ms: 8,
      })),
    ).toEqual({
      degraded: false,
      reasons: [],
    })
  })

  it("falls back to max loop lag when p95 lag is unavailable", () => {
    expect(
      classifyServerPerformance(serverMetrics({
        eventLoopLagMs: 25,
        eventLoopLagP95Ms: undefined,
      })),
    ).toEqual({
      degraded: true,
      reasons: ["event_loop_lag"],
    })
  })

  it("ignores sub-frame dropped debt when catch-up remains bounded", () => {
    expect(
      classifyServerPerformance(serverMetrics({
        droppedDebtMs: 1.5,
        catchUpCallbacks: 9,
        eventLoopLagMs: 51,
        eventLoopLagP95Ms: 8,
      })),
    ).toEqual({
      degraded: false,
      reasons: [],
    })
  })

  it("classifies dropped debt only at the diagnostic threshold", () => {
    expect(
      classifyServerPerformance(serverMetrics({
        droppedDebtMs: SERVER_DROPPED_DEBT_DIAGNOSTIC_THRESHOLD_MS - 0.001,
        catchUpCallbacks: 2,
      })),
    ).toEqual({
      degraded: false,
      reasons: [],
    })

    expect(
      classifyServerPerformance(serverMetrics({
        droppedDebtMs: SERVER_DROPPED_DEBT_DIAGNOSTIC_THRESHOLD_MS,
        catchUpCallbacks: 2,
      })),
    ).toEqual({
      degraded: true,
      reasons: ["dropped_debt", "catch_up"],
    })
  })

  it("classifies sustained loop lag only at the p95 diagnostic threshold", () => {
    expect(
      classifyServerPerformance(serverMetrics({
        eventLoopLagMs: 80,
        eventLoopLagP95Ms: SERVER_EVENT_LOOP_LAG_DIAGNOSTIC_THRESHOLD_MS - 0.001,
      })),
    ).toEqual({
      degraded: false,
      reasons: [],
    })

    expect(
      classifyServerPerformance(serverMetrics({
        eventLoopLagMs: 80,
        eventLoopLagP95Ms: SERVER_EVENT_LOOP_LAG_DIAGNOSTIC_THRESHOLD_MS,
      })),
    ).toEqual({
      degraded: true,
      reasons: ["event_loop_lag"],
    })
  })

  it("does not flag normal 8-client aggregate broadcast cost without loop debt", () => {
    expect(
      classifyServerPerformance({
        windowMs: 1_000,
        droppedDebtMs: 0,
        catchUpCallbacks: 0,
        inputQueueDrops: 0,
        simDurationMs: 40,
        broadcastDurationMs: 30,
        roomTickDurationMs: 42,
        visualFlushDurationMs: 10,
        ownerAckSendDurationMs: 5,
        immediateBroadcastDurationMs: 15,
        processEventLoopDelayMs: 2,
        processEventLoopDelayP95Ms: 1,
        eventLoopUtilization: 0.2,
        gcPauseMs: 0,
        eventLoopLagMs: 2,
        processCpuPercent: 20,
        heapUsedBytes: 1024,
        rssBytes: 2048,
        activeRooms: 1,
        connectedClients: 8,
      }),
    ).toEqual({
      degraded: false,
      reasons: [],
    })
  })
})
