import { describe, expect, it } from "vitest"

import {
  PERFORMANCE_ISSUE_ORDER,
  classifyServerPerformance,
  createRubberbandState,
  isAuthoritativeMessageStale,
  isRubberbanding,
  recordRubberbandCorrection,
  serverPerformanceStatusKey,
} from "./performanceIndicators"

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
      eventLoopLagMs: 25,
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

  it("does not flag normal 8-client aggregate broadcast cost without loop debt", () => {
    expect(
      classifyServerPerformance({
        windowMs: 1_000,
        droppedDebtMs: 0,
        catchUpCallbacks: 0,
        inputQueueDrops: 0,
        simDurationMs: 40,
        broadcastDurationMs: 30,
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
