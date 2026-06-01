/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ServerPerformanceStatusPayload } from "@/shared/types"

import { usePerformanceIndicators } from "./usePerformanceIndicators"

function degradedStatus(): ServerPerformanceStatusPayload {
  return {
    serverTimeMs: 1_000,
    degraded: true,
    reasons: ["dropped_debt"],
    metrics: {
      windowMs: 1_000,
      droppedDebtMs: 16,
      catchUpCallbacks: 0,
      inputQueueDrops: 0,
      simDurationMs: 5,
      broadcastDurationMs: 1,
      eventLoopLagMs: 0,
      processCpuPercent: 10,
      heapUsedBytes: 1,
      rssBytes: 2,
      activeRooms: 1,
      connectedClients: 1,
    },
  }
}

describe("usePerformanceIndicators", () => {
  it("combines connection, server, rubberband, and forced issue signals in priority order", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    const { result } = renderHook(() => usePerformanceIndicators())

    act(() => {
      result.current.setConnectionHealth("reconnecting")
      result.current.setServerPerformanceStatus(degradedStatus())
      result.current.recordPredictionCorrection("snap")
      result.current.setForcedIssues(["rubberbanding", "lost_connection"])
    })

    expect(result.current.issues).toEqual([
      "lost_connection",
      "server_cpu",
      "rubberbanding",
    ])

    vi.useRealTimers()
  })

  it("gates stale-message connection warnings behind active local input", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    const { result } = renderHook(() => usePerformanceIndicators())
    act(() => {
      result.current.recordAuthoritativeMessage(1_000)
    })

    act(() => {
      vi.setSystemTime(6_100)
    })
    expect(result.current.issues).toEqual([])

    act(() => {
      result.current.recordActiveLocalInput(6_100)
    })
    expect(result.current.issues).toEqual(["lost_connection"])

    vi.useRealTimers()
  })
})
