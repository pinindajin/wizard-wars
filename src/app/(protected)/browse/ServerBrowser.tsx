"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Client } from "@colyseus/sdk"

import { fetchWsAuthToken } from "@/lib/fetch-ws-auth-token"
import { getColyseusUrl } from "@/lib/endpoints"
import type { LobbyListEntry } from "@/app/api/lobbies/route"

const POLL_INTERVAL_MS = 5000

/** Phase labels shown in the UI for each LobbyPhase value. */
const PHASE_LABELS: Record<LobbyListEntry["lobbyPhase"], string> = {
  LOBBY: "In Lobby",
  WAITING_FOR_CLIENTS: "Loading…",
  COUNTDOWN: "Starting…",
  IN_PROGRESS: "In Progress",
  SCOREBOARD: "Scoreboard",
}

/** Phase badge colour classes. */
const PHASE_COLORS: Record<LobbyListEntry["lobbyPhase"], string> = {
  LOBBY: "bg-green-700 text-green-200",
  WAITING_FOR_CLIENTS: "bg-yellow-700 text-yellow-200",
  COUNTDOWN: "bg-orange-700 text-orange-200",
  IN_PROGRESS: "bg-red-800 text-red-200",
  SCOREBOARD: "bg-gray-600 text-gray-200",
}

/**
 * Fetches the list of available game lobbies from the API.
 *
 * @returns Array of LobbyListEntry objects.
 */
async function fetchLobbies(): Promise<LobbyListEntry[]> {
  try {
    const res = await fetch("/api/lobbies", { credentials: "include" })
    if (!res.ok) return []
    return (await res.json()) as LobbyListEntry[]
  } catch {
    return []
  }
}

/**
 * Server browser client component.
 * Polls `/api/lobbies` every 5 seconds and shows the live lobby list.
 * Allows creating a new lobby or joining an existing one.
 */
export default function ServerBrowser() {
  const router = useRouter()
  const [lobbies, setLobbies] = useState<LobbyListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /** Loads the current lobby list and updates state. */
  const loadLobbies = useCallback(async () => {
    const data = await fetchLobbies()
    setLobbies(data)
    setLoading(false)
  }, [])

  // Initial load + polling
  useEffect(() => {
    void loadLobbies()
    pollRef.current = setInterval(() => void loadLobbies(), POLL_INTERVAL_MS)
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current)
    }
  }, [loadLobbies])

  /**
   * Creates a new `game_lobby` room via the Colyseus matchmaker,
   * then navigates to `/lobby/[id]`.
   */
  const createLobby = useCallback(async () => {
    setCreating(true)
    setError(null)
    try {
      const token = await fetchWsAuthToken()
      if (!token) throw new Error("Not authenticated")
      const client = new Client(getColyseusUrl())
      const room = await client.create<unknown>("game_lobby", { token })
      router.push(`/lobby/${room.roomId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lobby")
      setCreating(false)
    }
  }, [router])

  /**
   * Joins an existing lobby and navigates to `/lobby/[id]`.
   *
   * @param lobbyId - The Colyseus room ID to join.
   */
  const joinLobby = useCallback(
    (lobbyId: string) => {
      router.push(`/lobby/${lobbyId}`)
    },
    [router],
  )

  /**
   * Navigates back to the home / chat page.
   */
  const goHome = useCallback(() => {
    router.push("/home")
  }, [router])

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-700 bg-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-purple-400">⚔ Wizard Wars</h1>
          <p className="text-xs text-gray-500 mt-0.5">Browse Games</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="rounded-md border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
            onClick={goHome}
            type="button"
          >
            ← Back to Chat
          </button>
          <button
            className="rounded-md bg-purple-600 px-5 py-2 text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
            onClick={() => void createLobby()}
            disabled={creating}
            type="button"
          >
            {creating ? "Creating…" : "+ Create Lobby"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Error banner */}
        {error && (
          <div className="mb-6 rounded border border-red-500 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Lobby list */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500">
            <span className="animate-pulse text-lg">Loading lobbies…</span>
          </div>
        ) : lobbies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-2xl">🧙</p>
            <p className="mt-3 text-gray-400 text-lg">No lobbies found</p>
            <p className="mt-1 text-gray-600 text-sm">
              Be the first to create one!
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4">
              {lobbies.length} Lobb{lobbies.length === 1 ? "y" : "ies"} Available
            </p>
            {lobbies.map((lobby) => (
              <div
                key={lobby.lobbyId}
                className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 px-5 py-4 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="font-semibold text-white">
                      {lobby.hostName ? `${lobby.hostName}'s Lobby` : "Open Lobby"}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {lobby.playerCount}/{lobby.maxPlayers} players
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PHASE_COLORS[lobby.lobbyPhase]}`}
                  >
                    {PHASE_LABELS[lobby.lobbyPhase]}
                  </span>
                </div>

                <button
                  className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => joinLobby(lobby.lobbyId)}
                  disabled={lobby.lobbyPhase === "IN_PROGRESS"}
                  type="button"
                >
                  {lobby.lobbyPhase === "IN_PROGRESS" ? "In Progress" : "Join"}
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
