import { describe, expect, it, vi } from "vitest"

import { createProcessEventLoopMonitor } from "./processEventLoopMonitor"

describe("process event-loop monitor", () => {
  it("snapshots event-loop delay, utilization, and gc pause with feature detection", () => {
    const histogram = {
      enable: vi.fn(),
      disable: vi.fn(),
      reset: vi.fn(),
      max: 12_000_000,
      percentile: vi.fn(() => 7_000_000),
    }
    let observerCallback: (items: {
      getEntries: () => Array<{ duration: number }>
    }) => void = () => {
      throw new Error("observer callback was not registered")
    }
    const observe = vi.fn()
    const disconnect = vi.fn()
    const monitor = createProcessEventLoopMonitor(
      { resolutionMs: 20, gcMetricsEnabled: true },
      {
        createDelayHistogram: vi.fn(() => histogram),
        nowEventLoopUtilization: vi
          .fn()
          .mockReturnValueOnce({ idle: 1, active: 1, utilization: 0.5 })
          .mockReturnValueOnce({ idle: 2, active: 3, utilization: 0.6 }),
        createGcObserver: (callback) => {
          observerCallback = callback
          return { observe, disconnect }
        },
      },
    )

    observerCallback({ getEntries: () => [{ duration: 3 }, { duration: 9 }] })

    expect(monitor.snapshotAndReset()).toEqual({
      processEventLoopDelayMs: 12,
      processEventLoopDelayP95Ms: 7,
      eventLoopUtilization: 0.6,
      gcPauseMs: 9,
    })
    expect(histogram.enable).toHaveBeenCalled()
    expect(histogram.reset).toHaveBeenCalled()
    expect(observe).toHaveBeenCalled()

    monitor.dispose()

    expect(histogram.disable).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
  })

  it("reports unavailable metrics instead of throwing when runtime APIs are absent", () => {
    const monitor = createProcessEventLoopMonitor(
      { resolutionMs: 20, gcMetricsEnabled: true },
      {
        createDelayHistogram: undefined,
        nowEventLoopUtilization: undefined,
        createGcObserver: undefined,
      },
    )

    expect(monitor.snapshotAndReset()).toEqual({
      unavailableReason: "event_loop_delay_unavailable,event_loop_utilization_unavailable,gc_metrics_unavailable",
    })
  })
})
