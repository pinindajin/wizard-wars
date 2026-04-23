"use client"

import type { LoaderStatus } from "@/game/loaderStatus"

/** Props for LoadingOverlay. */
type LoadingOverlayProps = {
  /**
   * Latest loader status. When `null` the overlay still renders (showing a
   * generic "Starting game" label) so it fully covers the Phaser canvas from
   * the very first frame — before any Phaser loader has published progress.
   */
  readonly status: LoaderStatus | null
}

/**
 * Opaque input-blocking overlay shown while Phaser loads its asset packs and
 * builds the Arena scene. Stays visible until Arena publishes
 * `{ phase: "complete" }`.
 *
 * Pointer events and keystrokes routed through this element are swallowed by
 * the `onPointerDown`/`onKeyDown` stoppers so players cannot accidentally
 * interact with the HUD (or trigger Phaser input) during load.
 *
 * @param props.status - The current loader status (or `null`).
 */
export default function LoadingOverlay({ status }: LoadingOverlayProps) {
  const description = status?.description ?? "Starting game"
  const loaded = status?.loaded ?? 0
  const total = status?.total ?? 0
  const label = `Loading ${description} [${loaded}/${total}]`
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#05070f] text-white"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="game-loading-overlay"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      tabIndex={-1}
    >
      <svg
        className="h-12 w-12 animate-spin text-purple-400"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        />
      </svg>
      <p
        className="font-mono text-base font-semibold tabular-nums text-purple-200"
        data-testid="game-loading-label"
      >
        {label}
      </p>
      <div className="h-2 w-72 overflow-hidden rounded bg-gray-800">
        <div
          className="h-full bg-purple-500 transition-[width] duration-150"
          style={{ width: `${pct}%` }}
          data-testid="game-loading-bar"
        />
      </div>
    </div>
  )
}
