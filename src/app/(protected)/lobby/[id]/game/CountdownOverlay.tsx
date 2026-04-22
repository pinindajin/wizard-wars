"use client"

import { useEffect, useRef, useState } from "react"
import { OVERLAY_FADE_MS } from "@/shared/balance-config/lobby"

/** How long each countdown tick lasts (ms). */
const TICK_MS = 1000

/** Props for CountdownOverlay. */
type CountdownOverlayProps = {
  /** Server timestamp (ms) when the countdown started. */
  readonly startAtServerTimeMs: number
  /** Total countdown duration in ms (e.g. 4000 for 3-2-1-GO). */
  readonly durationMs: number
  /** Called after GO! fades out — parent should unmount or clear this overlay. */
  readonly onDone?: () => void
}

/**
 * Derives the current countdown label from the elapsed time.
 *
 * @param elapsed - Milliseconds elapsed since countdownstart.
 * @param durationMs - Total countdown duration.
 * @returns "3" | "2" | "1" | "GO!" | "" when countdown is over.
 */
function getLabel(elapsed: number, durationMs: number): string {
  const remaining = durationMs - elapsed
  if (remaining > durationMs - TICK_MS) return "3"
  if (remaining > durationMs - TICK_MS * 2) return "2"
  if (remaining > durationMs - TICK_MS * 3) return "1"
  if (remaining > 0 || elapsed < durationMs + OVERLAY_FADE_MS) return "GO!"
  return ""
}

/**
 * Synced 3-2-1-GO! countdown overlay.
 * Derives the current number from `Date.now() - startAtServerTimeMs`.
 * Plays browser Audio SFX on each tick and on GO.
 * Fades out after GO! for `OVERLAY_FADE_MS` before calling `onDone`.
 *
 * @param props - CountdownOverlay props.
 */
export default function CountdownOverlay({
  startAtServerTimeMs,
  durationMs,
  onDone,
}: CountdownOverlayProps) {
  const [label, setLabel] = useState("")
  const [opacity, setOpacity] = useState(1)
  const prevLabelRef = useRef("")
  const doneRef = useRef(false)

  useEffect(() => {
    doneRef.current = false
    let rafId: number

    /**
     * RAF loop: recomputes the current label and triggers SFX / fade-out.
     */
    function tick() {
      const elapsed = Date.now() - startAtServerTimeMs
      const next = getLabel(elapsed, durationMs)

      // Play SFX on label change
      if (next !== prevLabelRef.current && next !== "") {
        prevLabelRef.current = next
        const sfxPath =
          next === "GO!"
            ? "/assets/sfx/sfx-countdown-go.mp3"
            : "/assets/sfx/sfx-countdown-beep.mp3"
        const audio = new Audio(sfxPath)
        audio.play().catch(() => undefined)
      }

      setLabel(next)

      // Begin fade-out after the GO! tick
      if (next === "GO!") {
        const sinceGo = elapsed - durationMs
        const progress = Math.min(sinceGo / OVERLAY_FADE_MS, 1)
        setOpacity(1 - progress)
        if (progress >= 1 && !doneRef.current) {
          doneRef.current = true
          onDone?.()
          return
        }
      } else {
        setOpacity(1)
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [startAtServerTimeMs, durationMs, onDone])

  if (!label) return null

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"
      style={{ opacity }}
      aria-live="assertive"
    >
      <div className="select-none text-center">
        <p
          className={`font-extrabold tabular-nums drop-shadow-lg transition-none ${
            label === "GO!"
              ? "text-9xl text-green-400"
              : "text-9xl text-purple-300"
          }`}
          style={{ textShadow: "0 0 40px rgba(168,85,247,0.7)" }}
        >
          {label}
        </p>
      </div>
    </div>
  )
}
