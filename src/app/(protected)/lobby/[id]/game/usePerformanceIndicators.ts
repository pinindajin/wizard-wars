"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import type {
  PerformanceIssueKind,
  RubberbandCorrection,
  RubberbandState,
} from "@/shared/performanceIndicators"
import {
  LOST_CONNECTION_STALE_MS,
  PERFORMANCE_ISSUE_ORDER,
  createRubberbandState,
  isAuthoritativeMessageStale,
  isRubberbanding,
  recordRubberbandCorrection,
} from "@/shared/performanceIndicators"
import type { ServerPerformanceStatusPayload } from "@/shared/types"

export type ConnectionHealth = "connected" | "reconnecting" | "disconnected" | "error"

const PERFORMANCE_INDICATOR_CLOCK_MS = 250

type UsePerformanceIndicatorsResult = {
  readonly issues: readonly PerformanceIssueKind[]
  readonly setConnectionHealth: (health: ConnectionHealth) => void
  readonly setServerPerformanceStatus: (
    status: ServerPerformanceStatusPayload | null,
  ) => void
  readonly recordAuthoritativeMessage: (atMs?: number) => void
  readonly recordActiveLocalInput: (atMs?: number) => void
  readonly recordPredictionCorrection: (
    correction: RubberbandCorrection,
    atMs?: number,
  ) => void
  readonly setForcedIssues: (issues: readonly PerformanceIssueKind[]) => void
}

/**
 * Returns active performance issues in stable visual priority order.
 *
 * @param active - Unordered active issue set.
 * @returns Ordered active issue list.
 */
function orderedIssues(
  active: ReadonlySet<PerformanceIssueKind>,
): readonly PerformanceIssueKind[] {
  return PERFORMANCE_ISSUE_ORDER.filter((issue) => active.has(issue))
}

/**
 * Tracks the three in-game performance warning signals.
 *
 * @returns Current issues and imperative recorders for room/game callbacks.
 */
export function usePerformanceIndicators(): UsePerformanceIndicatorsResult {
  const [connectionHealth, setConnectionHealth] =
    useState<ConnectionHealth>("connected")
  const [serverStatus, setServerPerformanceStatus] =
    useState<ServerPerformanceStatusPayload | null>(null)
  const [rubberbandState, setRubberbandState] = useState<RubberbandState>(() =>
    createRubberbandState(),
  )
  const [lastAuthoritativeMessageAtMs, setLastAuthoritativeMessageAtMs] =
    useState<number | null>(null)
  const [lastActiveLocalInputAtMs, setLastActiveLocalInputAtMs] =
    useState<number | null>(null)
  const [clockNowMs, setClockNowMs] = useState(0)
  const [forcedIssues, setForcedIssuesState] = useState<
    readonly PerformanceIssueKind[]
  >([])

  useEffect(() => {
    const refreshClock = () => {
      setClockNowMs(Date.now())
    }
    refreshClock()
    const intervalId = window.setInterval(
      refreshClock,
      PERFORMANCE_INDICATOR_CLOCK_MS,
    )
    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  const recordAuthoritativeMessage = useCallback((atMs = Date.now()) => {
    setClockNowMs(atMs)
    setLastAuthoritativeMessageAtMs(atMs)
  }, [])

  const recordActiveLocalInput = useCallback((atMs = Date.now()) => {
    setClockNowMs(atMs)
    setLastActiveLocalInputAtMs(atMs)
  }, [])

  const recordPredictionCorrection = useCallback(
    (correction: RubberbandCorrection, atMs = Date.now()) => {
      setClockNowMs(atMs)
      setRubberbandState((state) =>
        recordRubberbandCorrection(state, correction, atMs),
      )
    },
    [],
  )

  const setForcedIssues = useCallback(
    (issues: readonly PerformanceIssueKind[]) => {
      setForcedIssuesState(orderedIssues(new Set(issues)))
    },
    [],
  )

  const issues = useMemo(() => {
    const active = new Set<PerformanceIssueKind>(forcedIssues)
    const hasRecentLocalInput =
      lastActiveLocalInputAtMs !== null &&
      clockNowMs - lastActiveLocalInputAtMs <= LOST_CONNECTION_STALE_MS
    const staleWhileActive =
      hasRecentLocalInput &&
      lastAuthoritativeMessageAtMs !== null &&
      isAuthoritativeMessageStale(lastAuthoritativeMessageAtMs, clockNowMs)

    if (connectionHealth !== "connected" || staleWhileActive) {
      active.add("lost_connection")
    }
    if (serverStatus?.degraded) {
      active.add("server_cpu")
    }
    if (isRubberbanding(rubberbandState, clockNowMs)) {
      active.add("rubberbanding")
    }

    return orderedIssues(active)
  }, [
    clockNowMs,
    connectionHealth,
    forcedIssues,
    lastActiveLocalInputAtMs,
    lastAuthoritativeMessageAtMs,
    rubberbandState,
    serverStatus,
  ])

  return {
    issues,
    setConnectionHealth,
    setServerPerformanceStatus,
    recordAuthoritativeMessage,
    recordActiveLocalInput,
    recordPredictionCorrection,
    setForcedIssues,
  }
}
