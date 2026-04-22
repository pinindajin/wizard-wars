"use client"

import { overlayScrim, overlayScrimStyle, overlayCard } from "@/lib/ui/lobbyStyles"

/**
 * LoadingGate overlay.
 * Covers the screen while waiting for all players to signal ClientSceneReady.
 * The Phaser canvas renders beneath it.
 */
export default function LoadingGate() {
  return (
    <div
      className={overlayScrim}
      style={overlayScrimStyle}
      aria-live="polite"
      aria-busy="true"
    >
      <div className={overlayCard}>
        {/* Spinner */}
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
        <p className="text-lg font-semibold text-white">
          Waiting for players to load…
        </p>
        <p className="text-sm text-gray-400">
          The match will begin once everyone is ready.
        </p>
      </div>
    </div>
  )
}
