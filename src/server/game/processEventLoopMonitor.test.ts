import { describe, expect, it, vi } from "vitest"

import {
  createDefaultProcessEventLoopMonitorDeps,
  createProcessEventLoopMonitor,
  getProcessEventLoopMonitor,
  resetProcessEventLoopMonitorForTests,
} from "./processEventLoopMonitor"

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
        nowPerfMs: () => 1_000,
      },
    )

    observerCallback({ getEntries: () => [{ duration: 3 }, { duration: 9 }] })

    expect(monitor.snapshot()).toEqual({
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
        nowPerfMs: () => 1_000,
      },
    )

    expect(monitor.snapshot()).toEqual({
      unavailableReason: "event_loop_delay_unavailable,event_loop_utilization_unavailable,gc_metrics_unavailable",
    })
  })

  it("reports event-loop delay unavailable when the runtime exposes a throwing delay monitor stub", () => {
    const monitor = createProcessEventLoopMonitor(
      { resolutionMs: 20, gcMetricsEnabled: false },
      {
        createDelayHistogram: vi.fn(() => {
          throw new Error("perf_hooks.monitorEventLoopDelay is not yet implemented in Bun.")
        }),
        nowEventLoopUtilization: undefined,
        createGcObserver: undefined,
        nowPerfMs: () => 1_000,
      },
    )

    expect(monitor.snapshot()).toEqual({
      unavailableReason: "event_loop_delay_unavailable,event_loop_utilization_unavailable",
    })
  })

  it("publishes one stable process sample during the sample interval", () => {
    const histogram = {
      enable: vi.fn(),
      disable: vi.fn(),
      reset: vi.fn(),
      max: 12_000_000,
      percentile: vi.fn(() => 7_000_000),
    }
    const nowEventLoopUtilization = vi
      .fn()
      .mockReturnValueOnce({ idle: 1, active: 1, utilization: 0.5 })
      .mockReturnValueOnce({ idle: 2, active: 3, utilization: 0.6 })
      .mockReturnValueOnce({ idle: 3, active: 7, utilization: 0.7 })
      .mockReturnValueOnce({ idle: 4, active: 12, utilization: 0.8 })
    const monitor = createProcessEventLoopMonitor(
      { resolutionMs: 20, gcMetricsEnabled: false, sampleIntervalMs: 1_000 },
      {
        createDelayHistogram: vi.fn(() => histogram),
        nowEventLoopUtilization,
        createGcObserver: undefined,
        nowPerfMs: () => 1_000,
      },
    )

    const first = monitor.snapshot(1_000)
    const second = monitor.snapshot(1_010)
    histogram.max = 20_000_000

    expect(second).toBe(first)
    expect(histogram.reset).toHaveBeenCalledTimes(1)

    expect(monitor.snapshot(2_001)).toEqual({
      processEventLoopDelayMs: 20,
      processEventLoopDelayP95Ms: 7,
      eventLoopUtilization: 0.8,
    })
    expect(histogram.reset).toHaveBeenCalledTimes(2)
  })

  it("marks event-loop utilization unavailable for Bun default deps", () => {
    const deps = createDefaultProcessEventLoopMonitorDeps({ isBun: true })

    expect(deps.nowEventLoopUtilization).toBeUndefined()
  })

  it("marks invalid event-loop utilization samples unavailable", () => {
    const histogram = {
      enable: vi.fn(),
      disable: vi.fn(),
      reset: vi.fn(),
      max: 12_000_000,
      percentile: vi.fn(() => 7_000_000),
    }
    const monitor = createProcessEventLoopMonitor(
      { resolutionMs: 20, gcMetricsEnabled: false },
      {
        createDelayHistogram: vi.fn(() => histogram),
        nowEventLoopUtilization: vi
          .fn()
          .mockReturnValueOnce({ idle: 1, active: 1, utilization: 0.5 })
          .mockReturnValueOnce({ idle: 2, active: 3, utilization: Number.NaN }),
        createGcObserver: undefined,
        nowPerfMs: () => 1_000,
      },
    )

    expect(monitor.snapshot()).toEqual({
      processEventLoopDelayMs: 12,
      processEventLoopDelayP95Ms: 7,
      unavailableReason: "event_loop_utilization_unavailable",
    })
  })

  it("reuses and resets the singleton process monitor by option key", () => {
    resetProcessEventLoopMonitorForTests()

    const first = getProcessEventLoopMonitor({
      resolutionMs: 20,
      gcMetricsEnabled: false,
    })
    const reused = getProcessEventLoopMonitor({
      resolutionMs: 20,
      gcMetricsEnabled: false,
    })
    const replaced = getProcessEventLoopMonitor({
      resolutionMs: 20,
      gcMetricsEnabled: true,
    })

    expect(reused).toBe(first)
    expect(replaced).not.toBe(first)

    resetProcessEventLoopMonitorForTests()
  })

  it("exposes default process timing hooks for supported runtimes", () => {
    const deps = createDefaultProcessEventLoopMonitorDeps({ isBun: false })
    const gcObserver = deps.createGcObserver?.(() => undefined)

    expect(deps.nowPerfMs()).toBeGreaterThanOrEqual(0)

    gcObserver?.disconnect()
  })
})
