import {
  PerformanceObserver,
  monitorEventLoopDelay,
  performance,
} from "node:perf_hooks"

type DelayHistogram = {
  readonly max: number
  enable: () => void
  disable: () => void
  percentile: (percentile: number) => number
  reset: () => void
}

type GcObserver = {
  observe: (options: { readonly entryTypes: readonly ["gc"] }) => void
  disconnect: () => void
}

export type ProcessEventLoopMonitorOptions = {
  readonly resolutionMs: number
  readonly gcMetricsEnabled: boolean
  readonly sampleIntervalMs?: number
}

export type ProcessEventLoopMonitorSnapshot = {
  readonly processEventLoopDelayMs?: number
  readonly processEventLoopDelayP95Ms?: number
  readonly eventLoopUtilization?: number
  readonly gcPauseMs?: number
  readonly unavailableReason?: string
}

export type ProcessEventLoopMonitor = {
  snapshot: (nowPerfMs?: number) => ProcessEventLoopMonitorSnapshot
  dispose: () => void
}

export type ProcessEventLoopMonitorDeps = {
  readonly createDelayHistogram:
    | ((options: { readonly resolution: number }) => DelayHistogram)
    | undefined
  readonly nowEventLoopUtilization:
    | ((previous?: unknown) => { readonly utilization: number })
    | undefined
  readonly createGcObserver:
    | ((
        callback: (items: {
          getEntries: () => Array<{ readonly duration: number }>
        }) => void,
      ) => GcObserver)
    | undefined
  readonly nowPerfMs: () => number
}

export type ProcessEventLoopMonitorRuntime = {
  readonly isBun: boolean
}

const NS_PER_MS = 1_000_000
const DEFAULT_SAMPLE_INTERVAL_MS = 1_000

let singleton:
  | {
      readonly key: string
      readonly monitor: ProcessEventLoopMonitor
    }
  | null = null

/**
 * Creates a process-wide event-loop monitor with runtime feature detection.
 *
 * @param options - Sampling and GC-observation knobs.
 * @param deps - Runtime hooks, injectable for tests.
 * @returns Monitor that snapshots and resets aggregate process metrics.
 */
export function createProcessEventLoopMonitor(
  options: ProcessEventLoopMonitorOptions,
  deps: ProcessEventLoopMonitorDeps = createDefaultProcessEventLoopMonitorDeps(),
): ProcessEventLoopMonitor {
  const unavailableReasons: string[] = []
  const sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS
  let histogram: DelayHistogram | undefined
  try {
    histogram = deps.createDelayHistogram?.({
      resolution: options.resolutionMs,
    })
    histogram?.enable()
  } catch {
    histogram = undefined
  }
  if (!histogram) {
    unavailableReasons.push("event_loop_delay_unavailable")
  }

  let previousUtilization = deps.nowEventLoopUtilization?.()
  let sampledAtPerfMs = Number.NEGATIVE_INFINITY
  let lastSnapshot: ProcessEventLoopMonitorSnapshot | null = null
  if (!deps.nowEventLoopUtilization) {
    unavailableReasons.push("event_loop_utilization_unavailable")
  }

  let gcPauseMs = 0
  const gcObserver =
    options.gcMetricsEnabled && deps.createGcObserver
      ? deps.createGcObserver((items) => {
          for (const entry of items.getEntries()) {
            gcPauseMs = Math.max(gcPauseMs, entry.duration)
          }
        })
      : null
  if (gcObserver) {
    gcObserver.observe({ entryTypes: ["gc"] })
  } else if (options.gcMetricsEnabled) {
    unavailableReasons.push("gc_metrics_unavailable")
  }

  return {
    snapshot(nowPerfMs = deps.nowPerfMs()): ProcessEventLoopMonitorSnapshot {
      if (
        lastSnapshot &&
        nowPerfMs - sampledAtPerfMs < sampleIntervalMs
      ) {
        return lastSnapshot
      }
      const utilizationSample =
        deps.nowEventLoopUtilization?.(previousUtilization)
      const eventLoopUtilization =
        utilizationSample && Number.isFinite(utilizationSample.utilization)
          ? utilizationSample.utilization
          : undefined
      const snapshotUnavailableReasons = [
        ...unavailableReasons,
        ...(deps.nowEventLoopUtilization && eventLoopUtilization === undefined
          ? ["event_loop_utilization_unavailable"]
          : []),
      ]
      const snapshot: ProcessEventLoopMonitorSnapshot = {
        ...(histogram
          ? {
              processEventLoopDelayMs: histogram.max / NS_PER_MS,
              processEventLoopDelayP95Ms: histogram.percentile(95) / NS_PER_MS,
            }
          : {}),
        ...(eventLoopUtilization === undefined ? {} : { eventLoopUtilization }),
        ...(options.gcMetricsEnabled && gcObserver ? { gcPauseMs } : {}),
        ...(snapshotUnavailableReasons.length > 0
          ? { unavailableReason: snapshotUnavailableReasons.join(",") }
          : {}),
      }
      histogram?.reset()
      previousUtilization = deps.nowEventLoopUtilization?.()
      gcPauseMs = 0
      sampledAtPerfMs = nowPerfMs
      lastSnapshot = snapshot
      return snapshot
    },
    dispose(): void {
      histogram?.disable()
      gcObserver?.disconnect()
    },
  }
}

/**
 * Returns a singleton process monitor so room creation cannot multiply observers.
 *
 * @param options - Sampling and GC-observation knobs.
 * @returns Shared process event-loop monitor.
 */
export function getProcessEventLoopMonitor(
  options: ProcessEventLoopMonitorOptions,
): ProcessEventLoopMonitor {
  const key = [
    options.resolutionMs,
    options.gcMetricsEnabled ? "gc" : "nogc",
    options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
  ].join(":")
  if (singleton?.key === key) return singleton.monitor
  singleton?.monitor.dispose()
  const monitor = createProcessEventLoopMonitor(options)
  singleton = { key, monitor }
  return monitor
}

/**
 * Disposes the singleton monitor between tests.
 */
export function resetProcessEventLoopMonitorForTests(): void {
  singleton?.monitor.dispose()
  singleton = null
}

/**
 * Resolves Node perf_hooks-backed monitor dependencies for the current runtime.
 *
 * @param runtime - Runtime feature flags.
 * @returns Available event-loop and GC metric hooks.
 */
export function createDefaultProcessEventLoopMonitorDeps(
  runtime: ProcessEventLoopMonitorRuntime = detectProcessEventLoopMonitorRuntime(),
): ProcessEventLoopMonitorDeps {
  const perf = performance as typeof performance & {
    eventLoopUtilization?: (previous?: unknown) => { readonly utilization: number }
  }
  const supportedEntryTypes = (PerformanceObserver as unknown as {
    supportedEntryTypes?: readonly string[]
  }).supportedEntryTypes
  return {
    /* v8 ignore next 4 -- perf_hooks availability is fixed by the runtime. */
    createDelayHistogram:
      typeof monitorEventLoopDelay === "function"
        ? (options) => monitorEventLoopDelay(options) as DelayHistogram
        : undefined,
    nowEventLoopUtilization:
      !runtime.isBun && typeof perf.eventLoopUtilization === "function"
        ? (previous) => perf.eventLoopUtilization?.(previous)
        : undefined,
    /* v8 ignore next 3 -- GC PerformanceObserver support is fixed by the runtime. */
    createGcObserver: supportedEntryTypes?.includes("gc")
      ? (callback) => new PerformanceObserver(callback) as GcObserver
      : undefined,
    nowPerfMs: () => performance.now(),
  }
}

/**
 * Detects runtime capabilities that need coarse runtime-specific handling.
 *
 * @returns Runtime flags for default dependency resolution.
 */
function detectProcessEventLoopMonitorRuntime(): ProcessEventLoopMonitorRuntime {
  return {
    isBun: "Bun" in globalThis,
  }
}
