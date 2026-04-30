"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  LOBBY_IDLE_INFO_FADE_MS,
  LOBBY_IDLE_TIMEOUT_MS,
  LOBBY_IDLE_WARNING_THRESHOLD_MS,
} from "@/shared/balance-config/lobby"
import { statusPill, statusPillDanger, statusPillSuccess } from "@/lib/ui/lobbyStyles"
import type { LobbyPhase } from "@/shared/types"

const LOBBY_AFK_LABEL = "Lobby AFK Time" as const

const TICK_MS = 250

/**
 * Formats milliseconds as `m:ss` for countdown display (non-negative).
 *
 * @param ms - Duration in milliseconds.
 * @returns String like `5:00` or `0:42`.
 */
function formatCountdownMs(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ")
}

export type LobbyIdlePillProps = {
  /** Current lobby FSM phase from `LobbyStatePayload`. */
  readonly phase: LobbyPhase
  /** Server epoch ms when lobby idle kicks in; only set in `LOBBY`. */
  readonly lobbyIdleExpiresAtServerMs?: number
}

/**
 * Shows a red warning countdown when lobby idle is imminent, and a green
 * “Lobby AFK Time” preview with a live full-window countdown on click.
 *
 * @param props - Phase and optional idle deadline from the server.
 * @returns Pill UI or null when idle UI does not apply.
 */
export function LobbyIdlePill({ phase, lobbyIdleExpiresAtServerMs }: LobbyIdlePillProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [afkPreview, setAfkPreview] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)
  const [previewRemainingMs, setPreviewRemainingMs] = useState(LOBBY_IDLE_TIMEOUT_MS)
  const previewStartedAtRef = useRef<number>(0)

  const serverRemainingMs =
    phase === "LOBBY" && lobbyIdleExpiresAtServerMs !== undefined
      ? Math.max(0, lobbyIdleExpiresAtServerMs - nowMs)
      : 0

  const showRedWarning =
    phase === "LOBBY" &&
    lobbyIdleExpiresAtServerMs !== undefined &&
    serverRemainingMs > 0 &&
    serverRemainingMs <= LOBBY_IDLE_WARNING_THRESHOLD_MS

  useEffect(() => {
    if (phase === "LOBBY") return
    const id = window.requestAnimationFrame(() => {
      setAfkPreview(false)
      setFadeOut(false)
      setPreviewRemainingMs(LOBBY_IDLE_TIMEOUT_MS)
    })
    return () => window.cancelAnimationFrame(id)
  }, [phase])

  useEffect(() => {
    if (!showRedWarning && !afkPreview) return
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [showRedWarning, afkPreview])

  useEffect(() => {
    if (!afkPreview || fadeOut) return
    const id = window.setInterval(() => {
      const elapsed = Date.now() - previewStartedAtRef.current
      const remaining = Math.max(0, LOBBY_IDLE_TIMEOUT_MS - elapsed)
      setPreviewRemainingMs(remaining)
      if (remaining > 0) return

      window.clearInterval(id)
      const prefersReduced =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      if (prefersReduced) {
        setAfkPreview(false)
        setFadeOut(false)
        return
      }
      setFadeOut(true)
      window.setTimeout(() => {
        setAfkPreview(false)
        setFadeOut(false)
      }, LOBBY_IDLE_INFO_FADE_MS)
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [afkPreview, fadeOut])

  const startAfkPreview = useCallback(() => {
    previewStartedAtRef.current = Date.now()
    setFadeOut(false)
    setPreviewRemainingMs(LOBBY_IDLE_TIMEOUT_MS)
    setAfkPreview(true)
  }, [])

  if (phase !== "LOBBY" && !afkPreview) {
    return null
  }

  if (afkPreview) {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const fadeClass = fadeOut && !prefersReduced ? "opacity-0" : "opacity-100"
    const transitionMs = prefersReduced ? 0 : LOBBY_IDLE_INFO_FADE_MS

    return (
      <button
        type="button"
        className={joinClasses(
          statusPill,
          statusPillSuccess,
          fadeClass,
          "cursor-pointer select-none text-left transition-opacity",
        )}
        style={{ transitionDuration: `${transitionMs}ms` }}
        onClick={startAfkPreview}
        aria-label={`${LOBBY_AFK_LABEL}, ${formatCountdownMs(previewRemainingMs)} remaining`}
      >
        <span className="font-semibold text-emerald-100">{LOBBY_AFK_LABEL}</span>
        <span className="ml-2 tabular-nums text-emerald-50">
          {formatCountdownMs(previewRemainingMs)}
        </span>
      </button>
    )
  }

  if (!showRedWarning) {
    return null
  }

  return (
    <button
      type="button"
      className={joinClasses(statusPill, statusPillDanger, "cursor-pointer select-none text-left")}
      onClick={startAfkPreview}
      aria-label={`Lobby closes in ${formatCountdownMs(serverRemainingMs)}. Click for ${LOBBY_AFK_LABEL}.`}
    >
      <span className="font-semibold text-red-100">Closing</span>
      <span className="ml-2 tabular-nums text-red-50">{formatCountdownMs(serverRemainingMs)}</span>
    </button>
  )
}
