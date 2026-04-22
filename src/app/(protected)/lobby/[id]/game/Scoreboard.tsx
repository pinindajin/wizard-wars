"use client"

import { useCallback } from "react"
import type { ScoreboardEntry } from "@/shared/types"
import { HERO_CONFIGS } from "@/shared/balance-config/heroes"

/** Props for the Scoreboard component. */
type ScoreboardProps = {
  /** Array of player entries to display. */
  readonly entries: readonly ScoreboardEntry[]
  /** Called when the player clicks "Return to Lobby". Only shown in end-of-match mode. */
  readonly onReturnToLobby?: () => void
  /**
   * When true the scoreboard is rendered as a semi-transparent overlay
   * (Tab-held in-game variant). When false it is the full end-of-match scoreboard.
   */
  readonly isLive?: boolean
}

/**
 * Sorts scoreboard entries: kills desc → deaths asc → livesRemaining desc → playerId asc.
 *
 * @param entries - The unsorted entries array.
 * @returns A sorted copy of the entries array.
 */
function sortEntries(entries: readonly ScoreboardEntry[]): ScoreboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills
    if (a.deaths !== b.deaths) return a.deaths - b.deaths
    if (b.livesRemaining !== a.livesRemaining) return b.livesRemaining - a.livesRemaining
    return a.playerId.localeCompare(b.playerId)
  })
}

/**
 * End-of-match and live Tab-overlay scoreboard.
 * Displays a table of player stats sorted by kills descending.
 *
 * @param props - ScoreboardProps.
 */
export default function Scoreboard({
  entries,
  onReturnToLobby,
  isLive = false,
}: ScoreboardProps) {
  const sorted = sortEntries(entries)

  const containerClass = isLive
    ? "absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none"
    : "absolute inset-0 z-50 flex items-center justify-center bg-black/85"

  /**
   * Handles the Return to Lobby button click.
   */
  const handleReturn = useCallback(() => {
    onReturnToLobby?.()
  }, [onReturnToLobby])

  return (
    <div className={containerClass}>
      <div className="w-full max-w-3xl rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl p-6 pointer-events-auto">
        {/* Title */}
        <div className="mb-6 text-center">
          {isLive ? (
            <h2 className="text-xl font-bold text-white">Scoreboard</h2>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest text-purple-400">
                Match Over
              </p>
              <h2 className="mt-1 text-3xl font-extrabold text-white">
                Final Scores
              </h2>
            </>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="pb-3 pr-4">#</th>
                <th className="pb-3 pr-4">Username</th>
                <th className="pb-3 pr-4">Hero</th>
                <th className="pb-3 pr-4 text-right">Kills</th>
                <th className="pb-3 pr-4 text-right">Deaths</th>
                <th className="pb-3 pr-4 text-right">Lives</th>
                <th className="pb-3 text-right">Gold</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry, idx) => {
                const hero = HERO_CONFIGS[entry.heroId]
                const isTop = idx === 0

                return (
                  <tr
                    key={entry.playerId}
                    className={`border-b border-gray-800 transition-colors ${
                      isTop
                        ? "bg-purple-900/20 text-white"
                        : "text-gray-300"
                    }`}
                  >
                    <td className="py-3 pr-4 font-bold">
                      {idx === 0 ? (
                        <span className="text-yellow-400">👑</span>
                      ) : (
                        <span className="text-gray-600">{idx + 1}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-semibold">{entry.username}</td>
                    <td className="py-3 pr-4 text-gray-400">
                      {hero?.displayName ?? entry.heroId}
                    </td>
                    <td className="py-3 pr-4 text-right font-bold text-green-400">
                      {entry.kills}
                    </td>
                    <td className="py-3 pr-4 text-right text-red-400">
                      {entry.deaths}
                    </td>
                    <td className="py-3 pr-4 text-right">{entry.livesRemaining}</td>
                    <td className="py-3 text-right text-yellow-400">
                      {entry.goldEarned}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Return button (end-of-match only) */}
        {!isLive && onReturnToLobby && (
          <div className="mt-6 flex justify-center">
            <button
              className="rounded-lg bg-purple-600 px-8 py-3 font-semibold text-white hover:bg-purple-700 active:bg-purple-800"
              onClick={handleReturn}
              type="button"
            >
              Return to Lobby
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
